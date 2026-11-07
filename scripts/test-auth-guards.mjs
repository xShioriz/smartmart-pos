// ทดสอบสิทธิ์/guard กับเซิร์ฟเวอร์ที่รันอยู่:  npm run build && npm start   แล้วรัน:  node scripts/test-auth-guards.mjs
// ใช้ SESSION_SECRET จาก .env เพื่อ mint cookie ทดสอบ (ไม่พิมพ์ secret) และล้างข้อมูลทดสอบเองเมื่อจบ
import fs from "fs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }),
);
process.env.DATABASE_URL = env.DATABASE_URL;
process.env.DIRECT_URL = env.DIRECT_URL;

const B = process.env.BASE_URL || "http://localhost:3000";
const key = new TextEncoder().encode(env.SESSION_SECRET);
const mint = (userId, k = key) =>
  new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(k);

const db = new PrismaClient();
const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
const cashier = await db.user.findUniqueOrThrow({ where: { email: "cashier@smartmart.local" } });
const manifest = JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8")).node;
const actionId = (name) => Object.entries(manifest).find(([, v]) => v.exportedName === name)[0];

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(ok ? "✔" : "❌", name, extra);
};
const get = (path, token) => fetch(B + path, { redirect: "manual", headers: token ? { Cookie: `sm_session=${token}` } : {} });
const loc = (r) => r.headers.get("location") || "";
const body = async (p, t) => (await fetch(B + p, { headers: { Cookie: `sm_session=${t}` } })).text();
const act = async (name, args, token) => {
  const r = await fetch(B + "/users", {
    method: "POST",
    headers: { "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", ...(token ? { Cookie: `sm_session=${token}` } : {}) },
    body: JSON.stringify([args]),
  });
  return { status: r.status, text: await r.text() };
};

// 1) ไม่ล็อกอิน
for (const p of ["/", "/users", "/pos", "/dashboard"]) {
  const r = await get(p);
  check(`ไม่ล็อกอิน ${p} → /login`, r.status >= 300 && r.status < 400 && loc(r).includes("/login"), `${r.status}`);
}
// 2) cookie ปลอม
const forged = await mint(admin.id, new TextEncoder().encode("x".repeat(40)));
check("cookie เซ็นด้วย secret อื่น → /login", loc(await get("/users", forged)).includes("/login"));
check("cookie ขยะ → /login", loc(await get("/users", "garbage.token.value")).includes("/login"));

// 3) สิทธิ์ตามหน้า (หน้าที่ถูก redirect ตอบ 200 + NEXT_REDIRECT ในสตรีม และต้องไม่มีข้อมูลรั่ว)
const ct = await mint(cashier.id);
const at = await mint(admin.id);
const b1 = await body("/users", ct);
check("CASHIER เข้า /users → redirect และไม่มีข้อมูลรั่ว", b1.includes("NEXT_REDIRECT") && !b1.includes("admin@smartmart.local"));
check("CASHIER เข้า /dashboard → redirect", (await body("/dashboard", ct)).includes("NEXT_REDIRECT"));
check("CASHIER เข้า /pos ได้", (await get("/pos", ct)).status === 200);
check("ADMIN เข้า /users ได้ เห็นรายชื่อ", (await body("/users", at)).includes("admin@smartmart.local"));

// 4) Server Action โดยตรง
const newUser = { email: "hack.test@smartmart.local", name: "x", role: "ADMIN", password: "password123" };
let a = await act("createUserAction", newUser, ct);
check("CASHIER เรียก createUserAction → ปฏิเสธ", a.text.includes("ไม่มีสิทธิ์"));
a = await act("createUserAction", newUser, undefined);
check("ไม่ล็อกอิน createUserAction → ไม่สำเร็จ", !a.text.includes('"ok":true'));
check("ไม่มีผู้ใช้ hack.test ถูกสร้าง", (await db.user.count({ where: { email: newUser.email } })) === 0);
a = await act("setUserActiveAction", { id: admin.id, isActive: false }, at);
check("ADMIN ปิดบัญชีตัวเอง → ปฏิเสธ", a.text.includes("ปิดบัญชีของตัวเอง"));
a = await act("updateUserAction", { id: admin.id, name: "ผู้ดูแลระบบ", role: "CASHIER" }, at);
check("ADMIN ลดสิทธิ์ตัวเอง → ปฏิเสธ", a.text.includes("เปลี่ยนสิทธิ์ของตัวเอง"));
a = await act("createUserAction", { ...newUser, password: "short" }, at);
check("Zod: รหัสผ่านสั้น → ปฏิเสธ", a.text.includes("อย่างน้อย 8"));
a = await act("createUserAction", { ...newUser, email: "admin@smartmart.local" }, at);
check("อีเมลซ้ำ → ปฏิเสธ", a.text.includes("ถูกใช้แล้ว"));

// 4b) catalog actions
const prod = { sku: 'ZZGUARD-1', barcode: '', name: 'x', categoryId: '00000000-0000-4000-8000-000000000000', costPrice: '1', price: '1', unit: 'ชิ้น', minStock: 0, initialQty: 0, initialExpiry: '' };
a = await act('createProductAction', prod, ct); check('CASHIER เรียก createProductAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('updateProductAction', { ...prod, id: '00000000-0000-4000-8000-000000000000' }, ct); check('CASHIER เรียก updateProductAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('setProductActiveAction', { id: '00000000-0000-4000-8000-000000000000', isActive: false }, ct); check('CASHIER เรียก setProductActiveAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('createCategoryAction', { name: 'ZZGUARD', description: '' }, ct); check('CASHIER เรียก createCategoryAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('deleteCategoryAction', { id: '00000000-0000-4000-8000-000000000000' }, ct); check('CASHIER เรียก deleteCategoryAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
check('ไม่มีหมวด ZZGUARD ถูกสร้าง', (await db.category.count({ where: { name: 'ZZGUARD' } })) === 0);
for (const p of ['/products', '/categories']) check('CASHIER เข้า ' + p + ' → redirect ไม่รั่วข้อมูล', (await body(p, ct)).includes('NEXT_REDIRECT'));
check('ADMIN เข้า /products เห็นสินค้า seed', (await body('/products', at)).includes('DR001'));
check('ADMIN เข้า /categories เห็นหมวด seed', (await body('/categories', at)).includes('เครื่องดื่ม'));

// 4c) inventory
const zero = '00000000-0000-4000-8000-000000000000';
a = await act('receiveStockAction', { productId: zero, qty: 1, costPrice: '1', expiryDate: '', batchNo: '', note: '' }, ct); check('CASHIER เรียก receiveStockAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('adjustStockAction', { batchId: zero, mode: 'REMOVE', qty: 1, reason: 'x' }, ct); check('CASHIER เรียก adjustStockAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
a = await act('markAllNotificationsReadAction', undefined, ct); check('CASHIER เรียก markAllNotificationsReadAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
const inv = await body('/inventory', ct);
check('CASHIER ดู /inventory ได้ (คงเหลือ)', inv.includes('DR001') && !inv.includes('ประวัติเคลื่อนไหว'));
const invAlerts = await body('/inventory?tab=alerts', ct);
check('CASHIER ขอ tab=alerts → ได้แท็บคงเหลือเท่านั้น', !invAlerts.includes('อ่านทั้งหมด') && !invAlerts.includes('ไม่มีการแจ้งเตือน'));
const prodRow = await db.product.findUniqueOrThrow({ where: { sku: 'DR001' } });
const detailC = await body('/inventory/' + prodRow.id, ct);
check('CASHIER ดูรายละเอียดล็อตได้ แต่ไม่เห็นทุน/ปุ่มปรับ/ประวัติ', detailC.includes('ล็อตสินค้า') && !detailC.includes('รับสินค้าเข้า') && !detailC.includes('ทุน/หน่วย') && !detailC.includes('ประวัติการเคลื่อนไหวล่าสุด'));
const detailA = await body('/inventory/' + prodRow.id, at);
check('ADMIN เห็นปุ่มรับเข้า ทุน และประวัติ', detailA.includes('รับสินค้าเข้า') && detailA.includes('ทุน/หน่วย') && detailA.includes('ประวัติการเคลื่อนไหวล่าสุด'));
check('ADMIN เห็นแท็บแจ้งเตือน', (await body('/inventory?tab=alerts', at)).includes('แจ้งเตือน'));
check('id ไม่ใช่ uuid → หน้า 404', (await body('/inventory/not-a-uuid', at)).includes('NEXT_HTTP_ERROR_FALLBACK;404'));

// 4d) POS / checkout / ใบเสร็จ / ประวัติการขาย (สร้างสินค้าทดสอบเอง ลบเมื่อจบ)
{
  const cat = await db.category.findFirstOrThrow();
  const prod = await db.product.create({ data: { sku: 'ZZGUARD-POS', name: 'ZZGUARD POS', categoryId: cat.id, costPrice: '10', price: '50', stockQty: 10 } });
  await db.productBatch.create({ data: { productId: prod.id, batchNo: 'ZZG-1', costPrice: '10', initialQty: 10, remainingQty: 10 } });
  const uuid = () => crypto.randomUUID();
  const saleIdOf = (t) => (t.match(/"saleId":"([0-9a-f-]{36})"/) || [])[1];
  const stockNow = async () => (await db.product.findUniqueOrThrow({ where: { id: prod.id } })).stockQty;
  try {
    let r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '100' }, undefined);
    check('ไม่ล็อกอิน checkoutCashAction → ไม่สำเร็จ + ไม่ตัดสต็อก', !r.text.includes('"ok":true') && (await stockNow()) === 10);
    // แก้ราคาใน payload (ฟิลด์เกิน) ต้องไม่มีผล
    const key = uuid();
    r = await act('checkoutCashAction', { idempotencyKey: key, items: [{ productId: prod.id, quantity: 2, price: '0.01', unitPrice: '0.01' }], amountPaid: '1000', total: '0.02' }, at);
    const adminSale = saleIdOf(r.text);
    const s1 = adminSale && await db.sale.findUnique({ where: { id: adminSale } });
    check('ADMIN checkout สำเร็จ ยอดคิดจากราคาใน DB (ไม่เชื่อ payload)', !!s1 && s1.total.toFixed(2) === '100.00' && s1.changeAmount.toFixed(2) === '900.00' && (await stockNow()) === 8, s1 ? s1.total.toFixed(2) : r.text.slice(0, 120));
    r = await act('checkoutCashAction', { idempotencyKey: key, items: [{ productId: prod.id, quantity: 2 }], amountPaid: '1000' }, at);
    check('ส่ง key เดิมซ้ำ → ได้บิลเดิม ไม่ตัดสต็อกซ้ำ', saleIdOf(r.text) === adminSale && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '1' }, ct);
    check('รับเงินไม่พอ → ปฏิเสธ', r.text.includes('รับเงินไม่พอ') && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 99 }], amountPaid: '99999' }, ct);
    check('สต็อกไม่พอ → ปฏิเสธ ไม่ตัดสต็อก', r.text.includes('สต็อกไม่พอ') && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: -1 }], amountPaid: '100' }, ct);
    check('จำนวนติดลบ → ปฏิเสธ', !r.text.includes('"ok":true') && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '60' }, ct);
    const cashierSale = saleIdOf(r.text);
    check('CASHIER checkout สำเร็จ', !!cashierSale && (await stockNow()) === 7);
    const rc = (id, t) => body('/receipt/' + id, t);
    check('ADMIN ดูใบเสร็จของ CASHIER ได้', (await rc(cashierSale, at)).includes('ใบเสร็จรับเงิน'));
    check('CASHIER ดูใบเสร็จของตนเองได้', (await rc(cashierSale, ct)).includes('ใบเสร็จรับเงิน'));
    check('CASHIER ดูใบเสร็จของ ADMIN ไม่ได้ (404 ไม่รั่ว)', (await rc(adminSale, ct)).includes('NEXT_HTTP_ERROR_FALLBACK;404'));
    const adminReceiptNo = (await db.sale.findUniqueOrThrow({ where: { id: adminSale } })).receiptNo;
    const cashierReceiptNo = (await db.sale.findUniqueOrThrow({ where: { id: cashierSale } })).receiptNo;
    const listC = await body('/sales?q=SM-', ct), listA = await body('/sales?q=SM-', at);
    check('/sales: CASHIER เห็นเฉพาะบิลตนเอง', listC.includes(cashierReceiptNo) && !listC.includes(adminReceiptNo));
    check('/sales: ADMIN เห็นทุกบิล', listA.includes(cashierReceiptNo) && listA.includes(adminReceiptNo));
    check('/pos: ราคา/สต็อกแสดงจาก DB', (await body('/pos', ct)).includes('ZZGUARD POS'));
  } finally {
    const saleIds = (await db.saleItem.findMany({ where: { productId: prod.id }, select: { saleId: true } })).map((s) => s.saleId);
    await db.notification.deleteMany({ where: { productId: prod.id } });
    await db.stockMovement.deleteMany({ where: { productId: prod.id } });
    await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.sale.deleteMany({ where: { id: { in: saleIds } } });
    await db.productBatch.deleteMany({ where: { productId: prod.id } });
    await db.product.delete({ where: { id: prod.id } });
  }
}

// 4e) QR / webhook (ไม่ต้องล็อกอินสำหรับ webhook แต่ต้องไม่รับของปลอม)
{
  const hookUrl = B + "/api/webhooks/payment";
  let r = await fetch(hookUrl, { method: "POST", body: "not json", redirect: "manual" });
  check("webhook ไม่ถูกบังคับ login (ไม่ redirect) และ JSON พังถูกปฏิเสธ", [400, 401, 503].includes(r.status), String(r.status));
  r = await fetch(hookUrl, { redirect: "manual" });
  check("webhook รับเฉพาะ POST (GET → 405)", r.status === 405, String(r.status));
  const evId = "evnt_test_guard" + Date.now();
  r = await fetch(hookUrl, { method: "POST", body: JSON.stringify({ object: "event", id: evId, key: "charge.complete", data: { object: "charge", id: "chrg_test_doesnotexist" } }), redirect: "manual" });
  const j = await r.json().catch(() => ({}));
  check("webhook ปลอมของ charge ที่ไม่มีในระบบ → ไม่ทำอะไร (UNKNOWN_CHARGE หรือ 401 ถ้าตั้ง secret)", (r.status === 200 && j.outcome === "UNKNOWN_CHARGE") || r.status === 401 || r.status === 503, r.status + " " + JSON.stringify(j));
  await db.webhookEvent.deleteMany({ where: { providerEventId: evId } });
  const big = await fetch(hookUrl, { method: "POST", body: "x".repeat(200_000), redirect: "manual" });
  check("webhook payload ใหญ่เกิน → 413", big.status === 413, String(big.status));
  a = await act("startQrPaymentAction", { idempotencyKey: crypto.randomUUID(), items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }] }, undefined);
  check("ไม่ล็อกอิน startQrPaymentAction → ไม่สำเร็จ", !a.text.includes('"ok":true'));
  a = await act("getQrStatusAction", { paymentId: "00000000-0000-4000-8000-000000000000" }, undefined);
  check("ไม่ล็อกอิน getQrStatusAction → ไม่สำเร็จ", !a.text.includes('"ok":true'));
  a = await act("getQrStatusAction", { paymentId: "00000000-0000-4000-8000-000000000000" }, ct);
  check("แคชเชียร์ถามสถานะ payment ที่ไม่ใช่ของตน/ไม่มี → ไม่พบ", a.text.includes("ไม่พบรายการชำระเงิน"));
  a = await act("resolveReviewAction", { saleId: "00000000-0000-4000-8000-000000000000", action: "REFUNDED", note: "x" }, ct);
  check("CASHIER เรียก resolveReviewAction → ปฏิเสธ", a.text.includes("ไม่มีสิทธิ์"));
  check("/pos แสดงตัวเลือก PromptPay QR", (await body("/pos", ct)).length > 0);
  check("/sales/[id] ของบิลที่ไม่มี → 404", (await body("/sales/00000000-0000-4000-8000-000000000000", at)).includes("NEXT_HTTP_ERROR_FALLBACK;404"));
}

// 5) สร้างจริง → ปิดบัญชี → session เดิมใช้ไม่ได้ทันที → Audit
a = await act("createUserAction", { ...newUser, role: "CASHIER" }, at);
const created = await db.user.findUnique({ where: { email: newUser.email } });
check("ADMIN สร้างผู้ใช้ได้", !!created);
if (created) {
  const tk = await mint(created.id);
  check("ผู้ใช้ใหม่เข้า /pos ได้", (await get("/pos", tk)).status === 200);
  await act("setUserActiveAction", { id: created.id, isActive: false }, at);
  check("ปิดบัญชี → session เดิมใช้ไม่ได้ทันที", loc(await get("/pos", tk)).includes("/login"));
  const logs = await db.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true } });
  check("Audit: USER_CREATE + USER_DISABLE โดย ADMIN", logs.map((l) => l.action).join() === "USER_CREATE,USER_DISABLE" && logs.every((l) => l.userId === admin.id), logs.map((l) => l.action).join());
  await db.auditLog.deleteMany({ where: { entityId: created.id } });
  await db.user.delete({ where: { id: created.id } });
}
console.log(results.every(Boolean) ? "\nALL PASS" : "\nSOME FAILED");
await db.$disconnect();
process.exit(results.every(Boolean) ? 0 : 1);
