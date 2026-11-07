// Smoke test กับ Opn Payments Sandbox "ของจริง" (ไม่ใช่ FakeProvider): สร้าง QR → ตรวจสถานะ → จำลองผลด้วยกลไกของ Provider เอง
// รัน: npx tsx scripts/smoke-sandbox-qr.mts   (ต้องตั้ง PAYMENT_SANDBOX_SECRET_KEY ใน .env; ใช้ DB dev; ล้างข้อมูลทดสอบเมื่อจบ)
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
process.env.PAYMENT_ENV = "sandbox";

const { db } = await import("../src/server/db.ts");
const { Prisma } = await import("@prisma/client");
const { startQrPayment, reconcilePayment, cancelQrPayment } = await import("../src/server/services/payments.ts");
const { receiveBatch } = await import("../src/server/services/stock.ts");

const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
const actor = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
const auth = "Basic " + Buffer.from(env.PAYMENT_SANDBOX_SECRET_KEY + ":").toString("base64");
const api = async (path: string, method = "GET") => {
  const r = await fetch("https://api.omise.co" + path, { method, headers: { Authorization: auth } });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

const tag = `ZZSMOKE${Date.now().toString(36).toUpperCase()}`;
const cat = await db.category.create({ data: { name: tag } });
const prod = await db.product.create({ data: { sku: tag, name: tag, categoryId: cat.id, costPrice: 10, price: 50 } });
await db.$transaction((tx) => receiveBatch(tx, actor.id, { productId: prod.id, qty: 10, costPrice: new Prisma.Decimal(10), expiryDate: null, type: "RESTOCK", batchNo: "S1" }));
const stock = async () => (await db.product.findUniqueOrThrow({ where: { id: prod.id } })).stockQty;
const results: boolean[] = [];
const check = (name: string, ok: boolean, extra = "") => { results.push(ok); console.log(ok ? "✔" : "❌", name, extra); };

try {
  // 1) สร้าง QR จริง
  const st = await startQrPayment(actor, { idempotencyKey: crypto.randomUUID(), items: [{ productId: prod.id, quantity: 2 }] });
  const pay = await db.payment.findUniqueOrThrow({ where: { id: st.paymentId } });
  check("สร้าง QR จริงกับ Sandbox", st.status === "PENDING" && st.environment === "SANDBOX" && !!st.qrImageUrl && st.amount === "100.00", `charge …${pay.providerChargeId?.slice(-6)} qr-host=${new URL(st.qrImageUrl!).host}`);
  check("ยังไม่ตัดสต็อกตอนสร้าง QR", (await stock()) === 10);
  const remote = await api(`/charges/${pay.providerChargeId}`);
  check("Provider เห็น charge ยอด 10000 สตางค์ THB test-mode pending", remote.json.amount === 10000 && remote.json.currency === "thb" || remote.json.currency === "THB" ? remote.json.livemode === false && remote.json.status === "pending" : false, `${remote.json.amount}/${remote.json.currency}/${remote.json.status}`);
  check("reconcile ตอนยังไม่จ่าย → STILL_PENDING", (await reconcilePayment(st.paymentId, "reconcile")) === "STILL_PENDING");

  // 2) จำลอง "ล้มเหลว" ด้วย API ของ Provider (test mode)
  const failSt = await startQrPayment(actor, { idempotencyKey: crypto.randomUUID(), items: [{ productId: prod.id, quantity: 1 }] });
  const failPay = await db.payment.findUniqueOrThrow({ where: { id: failSt.paymentId } });
  const mf = await api(`/charges/${failPay.providerChargeId}/mark_as_failed`, "POST");
  console.log("  mark_as_failed →", mf.status, String(mf.json.status ?? mf.json.code));
  if (mf.status === 200) {
    check("Provider mark failed → reconcile → MARKED_FAILED, บิล CANCELLED", (await reconcilePayment(failSt.paymentId, "reconcile")) === "MARKED_FAILED" && (await db.sale.findUniqueOrThrow({ where: { id: failSt.saleId } })).status === "CANCELLED");
  }

  // 3) จำลอง "สำเร็จ" — ลองเรียก API ทดสอบ (ถ้า Provider รองรับ); ไม่รองรับ → ต้องกดที่ Dashboard เอง
  let paid = false;
  for (const ep of ["mark_as_paid", "mark_as_successful"]) {
    const r = await api(`/charges/${pay.providerChargeId}/${ep}`, "POST");
    console.log(`  ${ep} →`, r.status, String(r.json.status ?? r.json.code));
    if (r.status === 200 && r.json.status === "successful") { paid = true; break; }
  }
  if (paid) {
    check("Provider ยืนยันสำเร็จ → reconcile → CONFIRMED, ตัดสต็อก, ออกเลขใบเสร็จ", (await reconcilePayment(st.paymentId, "reconcile")) === "CONFIRMED" && (await stock()) === 8);
  } else {
    console.log("ℹ Sandbox ไม่มี API จำลองจ่ายสำเร็จ — ต้องกด Actions → Successful ที่ Dashboard (ทดสอบมือ); ยกเลิกรายการนี้แทน");
    const c = await cancelQrPayment(actor, st.paymentId);
    check("ยกเลิกโดยแคชเชียร์ (Provider ยัง pending) → FAILED/CANCELLED", c.status === "FAILED" && c.saleStatus === "CANCELLED" && (await stock()) === 10);
  }
} finally {
  const saleIds = (await db.saleItem.findMany({ where: { productId: prod.id }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  await db.webhookEvent.deleteMany({ where: { paymentId: { in: payIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...payIds, ...saleIds] } } });
  await db.notification.deleteMany({ where: { productId: prod.id } });
  await db.stockMovement.deleteMany({ where: { productId: prod.id } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.productBatch.deleteMany({ where: { productId: prod.id } });
  await db.product.delete({ where: { id: prod.id } });
  await db.category.delete({ where: { id: cat.id } });
  await db.$disconnect();
}
console.log(results.every(Boolean) ? "\nSMOKE PASS" : "\nSMOKE FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
