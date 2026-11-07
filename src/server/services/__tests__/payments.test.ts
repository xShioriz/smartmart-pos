// Integration test: PromptPay QR (ใช้ FakeProvider เฉพาะในไฟล์ทดสอบนี้ — ไม่ใช่การจำลองการจ่ายในแอป)
// ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZPAY และลบเมื่อจบ
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { _setProviderForTests } from "@/server/payments/registry";
import { getPaymentConfig } from "@/server/payments/config";
import { createOpnProvider } from "@/server/payments/opn";
import type { ProviderCharge } from "@/server/payments/types";
import { FakeProvider } from "./helpers/fake-provider";
import { _setPromotionLoaderForTests } from "@/server/services/promotions";
import { cancelQrPayment, getQrStatus, handleProviderWebhook, reconcilePayment, resolveReviewSale, startQrPayment, type WebhookResult } from "@/server/services/payments";
import { receiveBatch } from "@/server/services/stock";
import { checkoutCash } from "@/server/services/checkout";

const TAG = `ZZPAY${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let cashier: CurrentUser;
let catId: string;
let seq = 0;
const eventIds: string[] = [];

const evBody = (chargeId: string, key = "charge.complete", id = `evnt_test_${randomBytes(6).toString("hex")}`) => {
  eventIds.push(id);
  return { id, raw: JSON.stringify({ object: "event", id, key, livemode: false, data: { object: "charge", id: chargeId, status: "successful" } }) };
};
const hook = (chargeId: string, key?: string, id?: string, headers = new Headers()) => handleProviderWebhook(evBody(chargeId, key, id).raw, headers);

async function newProduct(price: string, stock: number) {
  seq++;
  const p = await db.product.create({ data: { sku: `${TAG}-${seq}`, name: `${TAG} สินค้า ${seq}`, categoryId: catId, costPrice: 40, price } });
  if (stock > 0) await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: p.id, qty: stock, costPrice: new Prisma.Decimal(40), expiryDate: null, type: "RESTOCK", batchNo: `L${seq}` }));
  return p;
}
const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stockQty;
const start = (items: { productId: string; quantity: number }[], actor = admin, key = randomUUID()) => startQrPayment(actor, { idempotencyKey: key, items });
const saleOf = (id: string) => db.sale.findUniqueOrThrow({ where: { id }, include: { payment: true, items: { include: { batches: true } } } });

beforeAll(async () => {
  const [a, c] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } }),
    db.user.findUniqueOrThrow({ where: { email: "cashier@smartmart.local" } }),
  ]);
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  cashier = { id: c.id, email: c.email, name: c.name, role: c.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  _setProviderForTests(fake);
  _setPromotionLoaderForTests(async () => []); // ตรวจยอดเงินแน่นอน ไม่ปนกับโปรโมชั่นจริงใน DB
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.notification.deleteMany({ where: { OR: [{ productId: { in: ids } }, { dedupeKey: { in: saleIds.map((s) => `PAYMENT_REVIEW:${s}`) } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...saleIds, ...payIds] } } });
  await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("เริ่มชำระด้วย QR", () => {
  it("สร้างบิลรอจ่าย + Payment PENDING (SANDBOX) + QR โดยยังไม่ตัดสต็อก/ไม่ออกเลขใบเสร็จ", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 2 }]);
    expect(st).toMatchObject({ status: "PENDING", saleStatus: "PENDING_PAYMENT", amount: "200.00", environment: "SANDBOX", receiptNo: null });
    expect(st.qrImageUrl).toContain("example.test");
    const sale = await saleOf(st.saleId);
    expect(sale).toMatchObject({ paymentMethod: "PROMPTPAY", receiptNo: null });
    expect(sale.payment!.providerChargeId).toMatch(/^chrg_test_/);
    expect(fake.charges.get(sale.payment!.providerChargeId!)!.metadata.paymentId).toBe(sale.payment!.id);
    expect(await stockOf(p.id)).toBe(5);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: "SALE" } })).toBe(0);
  });

  it("key เดิมซ้ำ → payment เดิม, เรียก Provider สร้าง charge ครั้งเดียว", async () => {
    const p = await newProduct("100", 5);
    const key = randomUUID();
    const before = fake.createCalls;
    const a = await start([{ productId: p.id, quantity: 1 }], admin, key);
    const b = await start([{ productId: p.id, quantity: 1 }], admin, key);
    expect(b.paymentId).toBe(a.paymentId);
    expect(fake.createCalls - before).toBe(1);
    await expect(start([{ productId: p.id, quantity: 1 }], cashier, key)).rejects.toThrow("ถูกใช้แล้ว");
  });

  it("ยอดต่ำกว่า 20 บาท / เกิน 150,000 บาท / สต็อกไม่พอ / สินค้าปิดใช้งาน → ปฏิเสธและไม่มีบิลค้าง", async () => {
    const cheap = await newProduct("19.99", 5);
    const big = await newProduct("100000", 5);
    const few = await newProduct("100", 1);
    const off = await newProduct("100", 5);
    await db.product.update({ where: { id: off.id }, data: { isActive: false } });
    const cases: [string, { productId: string; quantity: number }[]][] = [
      ["ต่ำกว่า 20", [{ productId: cheap.id, quantity: 1 }]],
      ["เกิน 150,000", [{ productId: big.id, quantity: 2 }]],
      ["สต็อกไม่พอ", [{ productId: few.id, quantity: 2 }]],
      ["ปิดใช้งาน", [{ productId: off.id, quantity: 1 }]],
    ];
    for (const [label, items] of cases) {
      const key = randomUUID();
      await expect(start(items, admin, key), label).rejects.toThrow(BusinessError);
      expect(await db.sale.count({ where: { idempotencyKey: key } }), label).toBe(0);
    }
  });

  it("Provider สร้าง charge ไม่สำเร็จ → Payment FAILED, บิล CANCELLED, ไม่ทิ้งบิลรอจ่าย", async () => {
    const p = await newProduct("100", 5);
    const key = randomUUID();
    fake.failCreate = true;
    try { await expect(start([{ productId: p.id, quantity: 1 }], admin, key)).rejects.toThrow("สร้าง QR ไม่สำเร็จ"); } finally { fake.failCreate = false; }
    const sale = await db.sale.findUniqueOrThrow({ where: { idempotencyKey: key }, include: { payment: true } });
    expect(sale.status).toBe("CANCELLED");
    expect(sale.payment!.status).toBe("FAILED");
    expect(await stockOf(p.id)).toBe(5);
  });
});

describe("ยืนยันการชำระเงิน", () => {
  it("webhook + Provider ยืนยัน → PAID, ปิดบิล, ออกเลขใบเสร็จ, ตัดสต็อก FEFO, บันทึกต้นทุน", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 3 }]);
    const sale0 = await saleOf(st.saleId);
    const chargeId = sale0.payment!.providerChargeId!;
    fake.pay(chargeId);
    const r = await hook(chargeId);
    expect(r).toMatchObject({ status: 200, body: { outcome: "CONFIRMED" } });

    const sale = await saleOf(st.saleId);
    expect(sale.status).toBe("COMPLETED");
    expect(sale.receiptNo).toMatch(/^SM-\d{8}-\d{5}$/);
    expect(sale.amountPaid.toFixed(2)).toBe("300.00");
    expect(sale.payment).toMatchObject({ status: "PAID", confirmedVia: "webhook", environment: "SANDBOX" });
    expect(sale.items[0].unitCost.toFixed(2)).toBe("40.00");
    expect(sale.items[0].batches.reduce((s, b) => s + b.quantity, 0)).toBe(3);
    expect(await stockOf(p.id)).toBe(2);
    expect(await db.stockMovement.count({ where: { saleId: st.saleId, type: "SALE" } })).toBe(1);
  });

  it("webhook ซ้ำ (event id เดิม) → ไม่ตัดสต็อกซ้ำ; event ใหม่ของ charge เดิม → ALREADY_PAID", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 1 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    fake.pay(chargeId);
    const e = evBody(chargeId);
    expect((await handleProviderWebhook(e.raw, new Headers())).body.outcome).toBe("CONFIRMED");
    expect((await handleProviderWebhook(e.raw, new Headers())).body).toMatchObject({ duplicate: true });
    expect((await hook(chargeId)).body.outcome).toBe("ALREADY_PAID");
    expect(await stockOf(p.id)).toBe(4);
    expect(await db.stockMovement.count({ where: { saleId: st.saleId, type: "SALE" } })).toBe(1);
  });

  it("webhook อ้างว่าสำเร็จ แต่ Provider API ยังบอก pending → ไม่เป็น PAID (ไม่เชื่อ body)", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 1 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    const r = await hook(chargeId); // fake ยังเป็น pending
    expect(r.body.outcome).toBe("STILL_PENDING");
    const sale = await saleOf(st.saleId);
    expect([sale.status, sale.payment!.status]).toEqual(["PENDING_PAYMENT", "PENDING"]);
    expect(await stockOf(p.id)).toBe(5);
  });

  it("ยอด/สกุลเงิน/โหมด/metadata ที่ Provider ตอบไม่ตรง → REJECTED_MISMATCH ไม่เป็น PAID", async () => {
    const p = await newProduct("100", 9);
    const mutate: [string, (c: ProviderCharge) => void][] = [
      ["ยอดไม่ตรง", (c) => { c.amountSatang -= 1; }],
      ["สกุลเงินไม่ใช่ THB", (c) => { c.currency = "USD"; }],
      ["โหมด live ไม่ตรงกับ sandbox", (c) => { c.livemode = true; }],
      ["metadata ของ payment อื่น", (c) => { c.metadata.paymentId = randomUUID(); }],
    ];
    for (const [label, fn] of mutate) {
      const st = await start([{ productId: p.id, quantity: 1 }]);
      const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
      fake.pay(chargeId);
      fn(fake.charges.get(chargeId)!);
      expect((await hook(chargeId)).body.outcome, label).toBe("REJECTED_MISMATCH");
      expect((await saleOf(st.saleId)).payment!.status, label).toBe("PENDING");
    }
    expect(await stockOf(p.id)).toBe(9);
  });

  it("charge ที่ไม่รู้จัก / event ชนิดอื่น / signature ผิด / JSON พัง", async () => {
    expect((await hook("chrg_test_unknown")).body.outcome).toBe("UNKNOWN_CHARGE");
    expect((await hook("chrg_test_unknown", "charge.create")).body.outcome).toBe("IGNORED_EVENT");
    const bad = await handleProviderWebhook(evBody("chrg_test_x").raw, new Headers({ "x-bad": "1" }));
    expect(bad.status).toBe(401);
    expect((await handleProviderWebhook("{not json", new Headers())).status).toBe(400);
    expect((await handleProviderWebhook(JSON.stringify({ id: 1 }), new Headers())).status).toBe(400);
  });

  it("Provider บอก failed/expired → Payment FAILED/EXPIRED, บิล CANCELLED, ไม่ตัดสต็อก", async () => {
    const p = await newProduct("100", 5);
    for (const [fn, want, outcome] of [[(id: string) => fake.fail(id), "FAILED", "MARKED_FAILED"], [(id: string) => fake.expire(id), "EXPIRED", "MARKED_EXPIRED"]] as const) {
      const st = await start([{ productId: p.id, quantity: 1 }]);
      const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
      fn(chargeId);
      expect((await hook(chargeId)).body.outcome).toBe(outcome);
      const sale = await saleOf(st.saleId);
      expect([sale.status, sale.payment!.status]).toEqual(["CANCELLED", want]);
    }
    expect(await stockOf(p.id)).toBe(5);
  });

  it("จ่ายล่าช้าหลัง QR หมดอายุ: ถ้าสต็อกพอ → เสร็จสมบูรณ์ (เงินเข้าแล้วต้องไม่หาย)", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 2 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    fake.expire(chargeId);
    await hook(chargeId);
    expect((await saleOf(st.saleId)).status).toBe("CANCELLED");
    fake.pay(chargeId); // ลูกค้าสแกนจ่ายทัน ณ Provider
    expect((await hook(chargeId)).body.outcome).toBe("CONFIRMED");
    expect((await saleOf(st.saleId)).status).toBe("COMPLETED");
    expect(await stockOf(p.id)).toBe(3);
  });

  it("สต็อกหมดระหว่างรอ: ได้รับเงินแล้ว → PAID_NEEDS_REVIEW + แจ้งเตือน ไม่ตัดอะไรเลย → แก้ด้วยผู้ดูแล", async () => {
    const p = await newProduct("100", 2);
    const st = await start([{ productId: p.id, quantity: 2 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    // มีคนซื้อเงินสดตัดสต็อกหมดก่อน
    await checkoutCash(cashier, { idempotencyKey: randomUUID(), items: [{ productId: p.id, quantity: 2 }], amountPaid: "200" });
    expect(await stockOf(p.id)).toBe(0);

    fake.pay(chargeId);
    expect((await hook(chargeId)).body.outcome).toBe("PAID_NEEDS_REVIEW");
    let sale = await saleOf(st.saleId);
    expect([sale.status, sale.payment!.status, sale.receiptNo]).toEqual(["PAID_NEEDS_REVIEW", "PAID", null]);
    expect(await db.notification.count({ where: { dedupeKey: `PAYMENT_REVIEW:${st.saleId}` } })).toBe(1);
    expect(await db.stockMovement.count({ where: { saleId: st.saleId } })).toBe(0);

    await expect(resolveReviewSale(admin, { saleId: st.saleId, action: "FULFILL", note: "ลอง" })).rejects.toThrow("สต็อกยังไม่พอ");
    await expect(resolveReviewSale(admin, { saleId: st.saleId, action: "REFUNDED", note: " " })).rejects.toThrow("หมายเหตุ");
    await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: p.id, qty: 5, costPrice: new Prisma.Decimal(40), expiryDate: null, type: "RESTOCK", batchNo: "REFILL" }));
    await resolveReviewSale(admin, { saleId: st.saleId, action: "FULFILL", note: "เติมสต็อกแล้ว" });
    sale = await saleOf(st.saleId);
    expect(sale.status).toBe("COMPLETED");
    expect(sale.receiptNo).not.toBeNull();
    expect(await stockOf(p.id)).toBe(3);
    expect(await db.notification.count({ where: { dedupeKey: `PAYMENT_REVIEW:${st.saleId}` } })).toBe(0);
    await expect(resolveReviewSale(admin, { saleId: st.saleId, action: "REFUNDED", note: "x" })).rejects.toThrow("ไม่ได้อยู่ในสถานะ");
  });

  it("ผู้ดูแลเลือกคืนเงิน (REFUNDED) → บิล CANCELLED + บันทึก audit", async () => {
    const p = await newProduct("100", 1);
    const st = await start([{ productId: p.id, quantity: 1 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    await checkoutCash(cashier, { idempotencyKey: randomUUID(), items: [{ productId: p.id, quantity: 1 }], amountPaid: "100" });
    fake.pay(chargeId);
    await hook(chargeId);
    await resolveReviewSale(admin, { saleId: st.saleId, action: "REFUNDED", note: "โอนคืนลูกค้าแล้ว" });
    expect((await saleOf(st.saleId)).status).toBe("CANCELLED");
    expect(await db.auditLog.count({ where: { entityId: st.saleId, action: "PAYMENT_REVIEW_REFUNDED" } })).toBe(1);
  });

  it("พร้อมกัน: webhook 3 ตัว (event ต่างกัน) + reconcile → ปิดบิลครั้งเดียว ตัดสต็อกครั้งเดียว", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 2 }]);
    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    const paymentId = st.paymentId;
    fake.pay(chargeId);
    const res = await Promise.all([hook(chargeId), hook(chargeId), hook(chargeId), reconcilePayment(paymentId, "reconcile")]);
    const outcomes = [...res.slice(0, 3).map((r) => String((r as WebhookResult).body.outcome)), String(res[3])];
    expect(outcomes.filter((o) => o === "CONFIRMED")).toHaveLength(1);
    expect(outcomes.every((o) => o === "CONFIRMED" || o === "ALREADY_PAID")).toBe(true);
    expect(await stockOf(p.id)).toBe(3);
    expect(await db.stockMovement.count({ where: { saleId: st.saleId, type: "SALE" } })).toBe(1);
    expect((await saleOf(st.saleId)).status).toBe("COMPLETED");
  });
});

describe("สถานะ / ยกเลิก / สิทธิ์", () => {
  it("poll สถานะ: เจ้าของและ ADMIN เห็นได้, แคชเชียร์อื่นไม่เห็น; reconcile สำรองเมื่อ webhook ไม่มา", async () => {
    const p = await newProduct("100", 5);
    const st = await start([{ productId: p.id, quantity: 1 }], cashier);
    expect((await getQrStatus(cashier, st.paymentId)).status).toBe("PENDING");
    await expect(getQrStatus({ ...cashier, id: randomUUID() }, st.paymentId)).rejects.toThrow("ไม่พบรายการชำระเงิน");
    expect((await getQrStatus(admin, st.paymentId)).paymentId).toBe(st.paymentId);

    const chargeId = (await saleOf(st.saleId)).payment!.providerChargeId!;
    fake.pay(chargeId);
    await new Promise((r) => setTimeout(r, 5100)); // รอให้พ้นช่วง throttle 5 วินาที
    const after = await getQrStatus(cashier, st.paymentId);
    expect(after).toMatchObject({ status: "PAID", saleStatus: "COMPLETED" });
    expect((await saleOf(st.saleId)).payment!.confirmedVia).toBe("reconcile");
  }, 20_000);

  it("ยกเลิกโดยแคชเชียร์: ยังไม่จ่าย → FAILED/CANCELLED; ถ้า Provider บอกจ่ายแล้ว → ได้ PAID แทนการยกเลิก", async () => {
    const p = await newProduct("100", 5);
    const a = await start([{ productId: p.id, quantity: 1 }]);
    const s1 = await cancelQrPayment(admin, a.paymentId);
    expect(s1).toMatchObject({ status: "FAILED", saleStatus: "CANCELLED", failureReason: "CANCELLED_BY_CASHIER" });

    const b = await start([{ productId: p.id, quantity: 1 }]);
    fake.pay((await saleOf(b.saleId)).payment!.providerChargeId!);
    const s2 = await cancelQrPayment(admin, b.paymentId);
    expect(s2).toMatchObject({ status: "PAID", saleStatus: "COMPLETED" });
    expect(await stockOf(p.id)).toBe(4);

    // ยกเลิกแล้ว แต่ลูกค้าสแกนจ่ายทันก่อนหมดเวลา → ระบบยังรับเงินและปิดบิล (พฤติกรรมที่ระบุในข้อจำกัด)
    fake.pay((await saleOf(a.saleId)).payment!.providerChargeId!);
    expect((await hook((await saleOf(a.saleId)).payment!.providerChargeId!)).body.outcome).toBe("CONFIRMED");
    expect(await stockOf(p.id)).toBe(3);
  });

  it("ความสอดคล้อง: ไม่มีบิล COMPLETED ที่ไม่มี Payment PAID, Σ batch = stockQty", async () => {
    const orphans = await db.sale.count({ where: { status: "COMPLETED", OR: [{ payment: null }, { payment: { status: { not: "PAID" } } }] } });
    expect(orphans).toBe(0);
    const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(drift[0].n)).toBe(0);
  });
});

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("การตั้งค่า Sandbox / Production", () => {
  const prodBase = { PAYMENT_ENV: "production", NODE_ENV: "production" };
  it("ไม่ตั้ง key = ปิดใช้งาน (ไม่ error)", () => {
    expect(getPaymentConfig(E({ NODE_ENV: "test" }))).toMatchObject({ enabled: false });
    expect(getPaymentConfig(E({ ...prodBase }))).toMatchObject({ enabled: false });
  });
  it("sandbox ต้องใช้ test key; live key ใน sandbox = error", () => {
    expect(getPaymentConfig(E({ PAYMENT_SANDBOX_SECRET_KEY: "skey_test_abc" }))).toMatchObject({ enabled: true, environment: "SANDBOX" });
    expect(() => getPaymentConfig(E({ PAYMENT_SANDBOX_SECRET_KEY: "skey_live_abc" }))).toThrow("test key");
  });
  it("production: ต้อง live key และต้องเป็น deployment production จริงเท่านั้น", () => {
    expect(getPaymentConfig(E({ ...prodBase, PAYMENT_LIVE_SECRET_KEY: "skey_abc" }))).toMatchObject({ enabled: true, environment: "PRODUCTION" });
    expect(() => getPaymentConfig(E({ ...prodBase, PAYMENT_LIVE_SECRET_KEY: "skey_test_abc" }))).toThrow("live key");
    expect(() => getPaymentConfig(E({ ...prodBase, VERCEL_ENV: "preview", PAYMENT_LIVE_SECRET_KEY: "skey_abc" }))).toThrow("production เท่านั้น");
    expect(() => getPaymentConfig(E({ PAYMENT_ENV: "production", NODE_ENV: "development", PAYMENT_LIVE_SECRET_KEY: "skey_abc" }))).toThrow("production เท่านั้น");
    expect(() => getPaymentConfig(E({ PAYMENT_ENV: "banana" }))).toThrow("PAYMENT_ENV");
  });
});

describe("ตรวจลายเซ็น webhook (Opn adapter)", () => {
  const secret = randomBytes(32).toString("base64");
  const provider = createOpnProvider({ secretKey: "skey_test_x", livemode: false, webhookSecret: secret });
  const body = JSON.stringify({ id: "evnt_test_1", key: "charge.complete", data: { id: "chrg_test_1" } });
  const sign = (ts: string, b = body, s = secret) => createHmac("sha256", Buffer.from(s, "base64")).update(`${ts}.${b}`).digest("hex");
  const hdr = (sig: string, ts: string) => new Headers({ "omise-signature": sig, "omise-signature-timestamp": ts });
  const now = () => String(Math.floor(Date.now() / 1000));

  it("ลายเซ็นถูกต้องผ่าน, รองรับหลายลายเซ็นตอนหมุน secret", () => {
    const ts = now();
    expect(provider.verifyWebhookSignature(body, hdr(sign(ts), ts))).toEqual({ checked: true, valid: true });
    expect(provider.verifyWebhookSignature(body, hdr(`${sign(ts, body, randomBytes(32).toString("base64"))},${sign(ts)}`, ts)).valid).toBe(true);
  });
  it("body ถูกแก้ / secret ผิด / ไม่มี header / timestamp เก่าเกิน 5 นาที → ไม่ผ่าน", () => {
    const ts = now();
    expect(provider.verifyWebhookSignature(body + " ", hdr(sign(ts), ts)).valid).toBe(false);
    expect(provider.verifyWebhookSignature(body, hdr(sign(ts, body, randomBytes(32).toString("base64")), ts)).valid).toBe(false);
    expect(provider.verifyWebhookSignature(body, new Headers()).valid).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(provider.verifyWebhookSignature(body, hdr(sign(old), old)).valid).toBe(false);
    expect(provider.verifyWebhookSignature(body, hdr("zz", ts)).valid).toBe(false);
  });
  it("ไม่ได้ตั้ง secret → checked=false (ต้องพึ่งการดึง Charge จาก API)", () => {
    const p = createOpnProvider({ secretKey: "skey_test_x", livemode: false, webhookSecret: null });
    expect(p.verifyWebhookSignature(body, new Headers())).toEqual({ checked: false, valid: true });
  });
});
