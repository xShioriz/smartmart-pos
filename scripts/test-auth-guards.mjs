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

let ownerUser = null;
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
check('ลิงก์เก่า /inventory?tab=alerts ถูกพาไป /notifications (ไม่แสดงแจ้งเตือนในหน้าคลัง)', invAlerts.includes('NEXT_REDIRECT') && !invAlerts.includes('อ่านทั้งหมด'));
const prodRow = await db.product.findUniqueOrThrow({ where: { sku: 'DR001' } });
const detailC = await body('/inventory/' + prodRow.id, ct);
check('CASHIER ดูรายละเอียดล็อตได้ แต่ไม่เห็นทุน/ปุ่มปรับ/ประวัติ', detailC.includes('ล็อตสินค้า') && !detailC.includes('รับสินค้าเข้า') && !detailC.includes('ทุน/หน่วย') && !detailC.includes('ประวัติการเคลื่อนไหวล่าสุด'));
const detailA = await body('/inventory/' + prodRow.id, at);
check('ADMIN เห็นปุ่มรับเข้า ทุน และประวัติ', detailA.includes('รับสินค้าเข้า') && detailA.includes('ทุน/หน่วย') && detailA.includes('ประวัติการเคลื่อนไหวล่าสุด'));
check('CASHIER เข้า /notifications และ /audit → redirect ไม่รั่วข้อมูล', (await body('/notifications', ct)).includes('NEXT_REDIRECT') && (await body('/audit', ct)).includes('NEXT_REDIRECT'));
check('ADMIN เข้า /notifications ได้', (await body('/notifications', at)).includes('การแจ้งเตือน'));
check('ADMIN เข้า /audit เห็นบันทึก', (await body('/audit', at)).includes('Audit Log'));
check('id ไม่ใช่ uuid → หน้า 404', (await body('/inventory/not-a-uuid', at)).includes('NEXT_HTTP_ERROR_FALLBACK;404'));

// 4d) POS / checkout / ใบเสร็จ / ประวัติการขาย (สร้างสินค้าทดสอบเอง ลบเมื่อจบ)
{
  const cat = await db.category.create({ data: { name: 'ZZGUARD-CAT' } });
  const prod = await db.product.create({ data: { sku: 'ZZGUARD-POS', name: 'ZZGUARD POS', categoryId: cat.id, costPrice: '10', price: '50', stockQty: 10 } });
  await db.productBatch.create({ data: { productId: prod.id, batchNo: 'ZZG-1', costPrice: '10', initialQty: 10, remainingQty: 10 } });
  const uuid = () => crypto.randomUUID();
  const saleIdOf = (t) => (t.match(/"saleId":"([0-9a-f-]{36})"/) || [])[1];
  const stockNow = async () => (await db.product.findUniqueOrThrow({ where: { id: prod.id } })).stockQty;
  try {
    let r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '100', expectedTotal: '50.00' }, undefined);
    check('ไม่ล็อกอิน checkoutCashAction → ไม่สำเร็จ + ไม่ตัดสต็อก', !r.text.includes('"ok":true') && (await stockNow()) === 10);
    // ยอดที่คาดไม่ตรง → ปฏิเสธ ไม่ตัดสต็อก
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '1000', expectedTotal: '1.00' }, at);
    check('expectedTotal ไม่ตรงกับที่เซิร์ฟเวอร์คำนวณ → ปฏิเสธ ไม่ตัดสต็อก', r.text.includes('ราคาหรือโปรโมชั่นเปลี่ยนแปลง') && (await stockNow()) === 10);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '1000' }, at);
    check('ไม่ส่ง expectedTotal → ปฏิเสธ (บังคับตรวจยอด)', !r.text.includes('"ok":true') && (await stockNow()) === 10);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '1000', expectedTotal: '50.00', memberId: uuid() }, at);
    check('สมาชิกที่ไม่มีอยู่ → ปฏิเสธ ไม่ตัดสต็อก', r.text.includes('ไม่พบสมาชิก') && (await stockNow()) === 10);
    r = await act('quoteCartAction', { items: [{ productId: prod.id, quantity: 2 }] }, ct);
    check('CASHIER ขอตัวอย่างราคาได้ (คิดจากราคาใน DB)', r.text.includes('"total":"100.00"'), r.text.slice(0, 160));
    r = await act('quoteCartAction', { items: [{ productId: prod.id, quantity: 2 }] }, undefined);
    check('ไม่ล็อกอิน quoteCartAction → ไม่สำเร็จ', !r.text.includes('"ok":true'));
    // แก้ราคาใน payload (ฟิลด์เกิน) ต้องไม่มีผล
    const key = uuid();
    r = await act('checkoutCashAction', { idempotencyKey: key, items: [{ productId: prod.id, quantity: 2, price: '0.01', unitPrice: '0.01' }], amountPaid: '1000', total: '0.02', expectedTotal: '100.00' }, at);
    const adminSale = saleIdOf(r.text);
    const s1 = adminSale && await db.sale.findUnique({ where: { id: adminSale } });
    check('ADMIN checkout สำเร็จ ยอดคิดจากราคาใน DB (ไม่เชื่อ payload)', !!s1 && s1.total.toFixed(2) === '100.00' && s1.changeAmount.toFixed(2) === '900.00' && (await stockNow()) === 8, s1 ? s1.total.toFixed(2) : r.text.slice(0, 120));
    r = await act('checkoutCashAction', { idempotencyKey: key, items: [{ productId: prod.id, quantity: 2 }], amountPaid: '1000', expectedTotal: '100.00' }, at);
    check('ส่ง key เดิมซ้ำ → ได้บิลเดิม ไม่ตัดสต็อกซ้ำ', saleIdOf(r.text) === adminSale && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '1', expectedTotal: '50.00' }, ct);
    check('รับเงินไม่พอ → ปฏิเสธ', r.text.includes('รับเงินไม่พอ') && (await stockNow()) === 8);
    // ยอดที่ถูกต้องของ 99 ชิ้น (อาจมีโปรโมชั่นทั้งบิลจริงใน DB) ขอจากเซิร์ฟเวอร์ แล้วค่อยลองขายเกินสต็อก
    const q99 = await act('quoteCartAction', { items: [{ productId: prod.id, quantity: 99 }] }, ct);
    const total99 = (q99.text.match(/"total":"(\d+\.\d\d)"/) || [])[1];
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 99 }], amountPaid: '99999', expectedTotal: total99 }, ct);
    check('สต็อกไม่พอ → ปฏิเสธ ไม่ตัดสต็อก', r.text.includes('สต็อกไม่พอ') && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: -1 }], amountPaid: '100', expectedTotal: '50.00' }, ct);
    check('จำนวนติดลบ → ปฏิเสธ', !r.text.includes('"ok":true') && (await stockNow()) === 8);
    r = await act('checkoutCashAction', { idempotencyKey: uuid(), items: [{ productId: prod.id, quantity: 1 }], amountPaid: '60', expectedTotal: '50.00' }, ct);
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

    // คืนสินค้า: ADMIN เท่านั้น + ผลต่อสต็อก/สถานะ + กันซ้ำ
    const adminItem = await db.saleItem.findFirstOrThrow({ where: { saleId: adminSale } });
    const retBody = (key, qty = 1) => ({ saleId: adminSale, items: [{ saleItemId: adminItem.id, quantity: qty, restock: true }], reason: 'ทดสอบ', refundNote: '', idempotencyKey: key });
    a = await act('previewReturnAction', { saleId: adminSale, items: [{ saleItemId: adminItem.id, quantity: 1, restock: true }] }, ct);
    check('CASHIER previewReturnAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
    a = await act('returnSaleAction', retBody(uuid()), ct);
    check('CASHIER returnSaleAction → ปฏิเสธ ไม่คืนสต็อก', a.text.includes('ไม่มีสิทธิ์') && (await stockNow()) === 7);
    a = await act('returnSaleAction', retBody(uuid()), undefined);
    check('ไม่ล็อกอิน returnSaleAction → ไม่สำเร็จ', !a.text.includes('"ok":true') && (await stockNow()) === 7);
    const rkey = uuid();
    a = await act('returnSaleAction', retBody(rkey), at);
    check('ADMIN คืน 1 ชิ้น: คืนเงิน 50.00, สต็อกกลับ, บิลเป็นคืนบางส่วน', a.text.includes('"refundTotal":"50.00"') && (await stockNow()) === 8 && (await db.sale.findUniqueOrThrow({ where: { id: adminSale } })).status === 'PARTIALLY_RETURNED', a.text.slice(0, 160));
    a = await act('returnSaleAction', retBody(rkey), at);
    check('ส่งคำขอคืนเดิมซ้ำ (key เดิม) → ไม่คืนซ้ำ', (await stockNow()) === 8 && (await db.saleReturn.count({ where: { saleId: adminSale } })) === 1);
    a = await act('returnSaleAction', retBody(uuid(), 5), at);
    check('คืนเกินจำนวนที่เหลือ → ปฏิเสธ', a.text.includes('คืน') && (await stockNow()) === 8 && (await db.saleReturn.count({ where: { saleId: adminSale } })) === 1);
    const detailAdmin = await body('/sales/' + adminSale, at);
    check('ADMIN เห็นปุ่มคืนสินค้าและประวัติการคืนในรายละเอียดบิล', detailAdmin.includes('คืนสินค้า') && detailAdmin.includes('RT-'));
    check('CASHIER ดูรายละเอียดบิลของตนเองได้ แต่ไม่เห็นปุ่มคืนสินค้า', !(await body('/sales/' + cashierSale, ct)).includes('คืนสินค้า / คืนเงิน'));
    check('CASHIER ดูรายละเอียดบิลของ ADMIN ไม่ได้ (404)', (await body('/sales/' + adminSale, ct)).includes('NEXT_HTTP_ERROR_FALLBACK;404'));

    // OWNER (เจ้าของร้าน): เห็นทุกบิล + คืน/ยกเลิกบิลได้ แต่ไม่มีสิทธิ์งานผู้ดูแลระบบ
    ownerUser = await db.user.create({ data: { email: 'zzowner.guard@smartmart.local', name: 'ZZ Owner', role: 'OWNER', passwordHash: 'x' } });
    const ot = await mint(ownerUser.id);
    check('OWNER เข้า /pos ได้', (await get('/pos', ot)).status === 200);
    for (const p of ['/users', '/settings', '/audit', '/notifications']) check('OWNER เข้า ' + p + ' → redirect ไม่รั่วข้อมูล', (await body(p, ot)).includes('NEXT_REDIRECT'));
    for (const p of ['/dashboard', '/products', '/categories', '/promotions', '/members', '/reports', '/inventory/reorder']) check('OWNER เข้า ' + p + ' ได้', (await get(p, ot)).status === 200);
    a = await act('createCategoryAction', { name: 'ZZOWNERCAT', description: '' }, ot);
    check('OWNER createCategoryAction ได้', a.text.includes('"ok":true'));
    await db.category.deleteMany({ where: { name: 'ZZOWNERCAT' } });
    a = await act('receiveStockAction', { productId: zero, qty: 1, costPrice: '1', expiryDate: '', batchNo: '', note: '' }, ot);
    check('OWNER receiveStockAction → ปฏิเสธ (รับสต็อกยังเป็น ADMIN)', a.text.includes('ไม่มีสิทธิ์'));
    a = await act('createUserAction', { ...newUser, email: 'zzowner.hack@smartmart.local', role: 'ADMIN' }, ot);
    check('OWNER createUserAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์') && !(await db.user.findUnique({ where: { email: 'zzowner.hack@smartmart.local' } })));
    a = await act('resolveReviewAction', { saleId: zero, action: 'FULFILL', note: 'x' }, ot);
    check('OWNER resolveReviewAction → ปฏิเสธ (คงเป็น ADMIN เท่านั้น)', a.text.includes('ไม่มีสิทธิ์'));
    const listO = await body('/sales?q=SM-', ot);
    check('/sales: OWNER เห็นบิลของแคชเชียร์และของ ADMIN', listO.includes(cashierReceiptNo) && listO.includes(adminReceiptNo));
    check('OWNER เห็นปุ่มยกเลิกบิลในรายละเอียดบิลของแคชเชียร์', (await body('/sales/' + cashierSale, ot)).includes('ยกเลิกบิล'));
    const ownerItem = await db.saleItem.findFirstOrThrow({ where: { saleId: cashierSale } });
    a = await act('returnSaleAction', { saleId: cashierSale, items: [{ saleItemId: ownerItem.id, quantity: ownerItem.quantity, restock: true }], reason: 'ยกเลิกบิล (ทดสอบ OWNER)', refundNote: '', idempotencyKey: uuid() }, ot);
    check('OWNER ยกเลิกทั้งบิลได้: สต็อกกลับ, บิลเป็นคืนทั้งบิล', a.text.includes('"ok":true') && (await stockNow()) === 9 && (await db.sale.findUniqueOrThrow({ where: { id: cashierSale } })).status === 'FULLY_RETURNED', a.text.slice(0, 160));
  } finally {
    const saleIds = (await db.saleItem.findMany({ where: { productId: prod.id }, select: { saleId: true } })).map((s) => s.saleId);
    await db.notification.deleteMany({ where: { productId: prod.id } });
    await db.stockMovement.deleteMany({ where: { productId: prod.id } });
    await db.saleReturn.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.sale.deleteMany({ where: { id: { in: saleIds } } });
    await db.productBatch.deleteMany({ where: { productId: prod.id } });
    await db.product.delete({ where: { id: prod.id } });
    await db.category.delete({ where: { id: cat.id } });
    if (ownerUser) {
      await db.auditLog.deleteMany({ where: { userId: ownerUser.id } });
      await db.user.delete({ where: { id: ownerUser.id } });
    }
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

// 4f) โปรโมชั่น / สมาชิก
{
  const z = '00000000-0000-4000-8000-000000000000';
  for (const p of ['/promotions', '/members', '/members/' + z]) check('CASHIER เข้า ' + p + ' → redirect ไม่รั่วข้อมูล', (await body(p, ct)).includes('NEXT_REDIRECT'));
  check('ADMIN เข้า /promotions เห็นโปรโมชั่น', (await body('/promotions', at)).includes('โปรโมชั่น'));
  check('ADMIN เข้า /members เห็นสมาชิก seed', (await body('/members', at)).includes('M0001'));
  check('/members/[id] ที่ไม่มี → 404', (await body('/members/' + z, at)).includes('NEXT_HTTP_ERROR_FALLBACK;404'));
  const promo = { name: 'x', scope: 'BILL', discountType: 'PERCENT', value: '10', productId: '', categoryId: '', minPurchase: '', startsAt: '2026-01-01T00:00', endsAt: '2026-12-31T00:00' };
  a = await act('createPromotionAction', promo, ct); check('CASHIER createPromotionAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
  a = await act('setPromotionActiveAction', { id: z, isActive: false }, ct); check('CASHIER setPromotionActiveAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
  a = await act('createMemberAction', { name: 'x', phone: '0899999999', email: '' }, ct); check('CASHIER createMemberAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
  a = await act('setMemberActiveAction', { id: z, isActive: false }, ct); check('CASHIER setMemberActiveAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
  a = await act('createPromotionAction', { ...promo, value: '150' }, at); check('ADMIN สร้างโปร % เกิน 100 → ปฏิเสธ (Zod)', a.text.includes('ไม่เกิน 100'));
  a = await act('createMemberAction', { name: 'x', phone: '123', email: '' }, at); check('ADMIN สร้างสมาชิกเบอร์ผิดรูปแบบ → ปฏิเสธ', a.text.includes('เบอร์โทร'));
  a = await act('searchMembersAction', { q: 'ส' }, ct); check('ค้นหาสมาชิกคำสั้นเกิน → ไม่ได้ผลลัพธ์', a.text.includes('"ok":true') && a.text.includes('[]'));
  a = await act('searchMembersAction', { q: 'M000' }, ct);
  check('CASHIER ค้นหาสมาชิกที่ POS ได้ และไม่เห็นเบอร์เต็ม/อีเมล', a.text.includes('M0001') && !/"phone":/.test(a.text) && !/0810000001/.test(a.text) && !a.text.includes('email'));
  a = await act('searchMembersAction', { q: 'M000' }, undefined); check('ไม่ล็อกอิน searchMembersAction → ไม่สำเร็จ', !a.text.includes('M0001'));
}

// 4g) Dashboard / รายงาน / ตั้งค่า (Day 9)
{
  for (const p of ['/dashboard', '/reports', '/settings']) check('CASHIER เข้า ' + p + ' → redirect ไม่รั่วข้อมูล', (await body(p, ct)).includes('NEXT_REDIRECT'));
  for (const p of ['/dashboard', '/dashboard?range=30', '/reports', '/reports?from=2026-01-01&to=2026-01-31', '/settings']) {
    const r = await get(p, at);
    check('ADMIN เปิด ' + p + ' ได้ (200)', r.status === 200, String(r.status));
  }
  const dash = await body('/dashboard', at);
  check('Dashboard แสดงตัวชี้วัดหลักและ Smart BI พร้อมป้ายระบุว่าไม่ใช่ AI', dash.includes('ยอดขายสุทธิวันนี้') && dash.includes('Smart BI') && dash.includes('ไม่ใช้ AI'));
  const rep = await body('/reports', at);
  check('รายงานแสดงสรุปและแยกเงินสด/QR', rep.includes('ยอดขายสุทธิ') && rep.includes('PromptPay QR') && rep.includes('วิธีคำนวณ'));
  const badRange = await body('/reports?from=2026-12-31&to=2026-01-01', at);
  check('ช่วงวันที่ย้อนกลับ → ใช้ค่าเริ่มต้นพร้อมข้อความแจ้ง (ไม่ error)', badRange.includes('ต้องไม่หลังวันสิ้นสุด'));
  const hugeRange = await body('/reports?from=2000-01-01&to=2026-01-01', at);
  check('ช่วงวันเกิน 366 วัน → ใช้ค่าเริ่มต้นพร้อมข้อความแจ้ง', hugeRange.includes('ไม่เกิน 366 วัน'));
  const garbage = await get('/reports?from=<script>&to=x', at);
  check('พารามิเตอร์วันที่ขยะไม่ทำให้พัง (200)', garbage.status === 200, String(garbage.status));
  const st = await body('/settings', at);
  check('หน้าตั้งค่าไม่เผยแพร่ secret key ของ Provider', !/skey_(test|live)_/.test(st) && st.includes('อ่านอย่างเดียว'));
  a = await act('updateSettingsAction', { store_name: 'x', store_address: '', store_phone: '', receipt_footer: '', points_per_baht: 25, near_expiry_days: 30, qr_expire_minutes: 10 }, ct);
  check('CASHIER updateSettingsAction → ปฏิเสธ', a.text.includes('ไม่มีสิทธิ์'));
  a = await act('updateSettingsAction', { store_name: 'x', store_address: '', store_phone: '', receipt_footer: '', points_per_baht: 0, near_expiry_days: 30, qr_expire_minutes: 10 }, at);
  check('ADMIN ตั้งค่าไม่ถูกต้อง (แต้ม 0) → ปฏิเสธโดยไม่บันทึก', a.text.includes('ไม่น้อยกว่า 1'));
  a = await act('updateSettingsAction', { store_name: 'x', store_address: '', store_phone: '', receipt_footer: '', points_per_baht: 25, near_expiry_days: 30, qr_expire_minutes: 10 }, undefined);
  check('ไม่ล็อกอิน updateSettingsAction → ไม่สำเร็จ', !a.text.includes('"ok":true'));
}

// 4h) ส่งออก CSV / ปิดกะ (ส่วนเพิ่มหลังจบ Day 10)
{
  const q = '/reports/export?type=daily&from=2026-01-01&to=2026-01-31';
  let r = await get(q);
  check('ไม่ล็อกอิน export CSV → redirect /login', r.status >= 300 && r.status < 400 && loc(r).includes('/login'), String(r.status));
  r = await get(q, ct);
  check('CASHIER export CSV → 403', r.status === 403, String(r.status));
  r = await get(q, at);
  const buf = Buffer.from(await r.arrayBuffer()); // fetch().text() ตัด BOM ทิ้ง จึงตรวจจากไบต์จริง
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const csvText = buf.toString('utf8').replace(/^﻿/, '');
  check('ADMIN export รายวัน → 200 เป็น text/csv พร้อมชื่อไฟล์', r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv') && (r.headers.get('content-disposition') || '').includes('smartmart-daily-2026-01-01_2026-01-31.csv'), String(r.status));
  check('CSV มี BOM, หัวตารางภาษาไทย, แถวรวม และครบ 31 วัน', hasBom && csvText.includes('วันที่,จำนวนบิล') && csvText.includes('รวม,') && csvText.trim().split('\r\n').length === 1 + 31 + 1);
  r = await get('/reports/export?type=products&from=2026-01-01&to=2026-01-31', at);
  check('ADMIN export สินค้าขายดี → 200', r.status === 200 && (await r.text()).includes('อันดับ,รหัสสินค้า'));
  for (const [name, p] of [
    ['type ผิด', '/reports/export?type=x&from=2026-01-01&to=2026-01-31'],
    ['ไม่มีพารามิเตอร์', '/reports/export'],
    ['วันเริ่มหลังวันสิ้นสุด', '/reports/export?type=daily&from=2026-02-01&to=2026-01-01'],
    ['วันที่ไม่มีจริง (31 ก.พ.)', '/reports/export?type=daily&from=2026-02-31&to=2026-03-01'],
    ['ช่วงเกิน 366 วัน', '/reports/export?type=daily&from=2000-01-01&to=2026-01-01'],
    ['พารามิเตอร์ขยะ', '/reports/export?type=daily&from=%3Cscript%3E&to=x'],
  ]) {
    r = await get(p, at);
    check('export ' + name + ' → 400 (ไม่พัง)', r.status === 400, String(r.status));
  }

  // ปิดกะ: หน้า + สิทธิ์ + action
  check('ไม่ล็อกอินเปิด /shifts → /login', loc(await get('/shifts')).includes('/login'));
  r = await get('/shifts', at);
  check('ADMIN เปิด /shifts ได้', r.status === 200);
  r = await get('/shifts', ct);
  const shiftBody = await r.text();
  check('CASHIER เปิด /shifts ได้ แต่ไม่เห็นประวัติกะ (เฉพาะ ADMIN)', r.status === 200 && shiftBody.includes('ปิดกะ') && !shiftBody.includes('ประวัติกะ'));
  check('ADMIN เห็นประวัติกะ', (await body('/shifts', at)).includes('ประวัติกะ'));

  const hasOpen = (await db.shift.count({ where: { status: 'OPEN' } })) > 0;
  let a = await act('openShiftAction', { openingCash: '1000' }, undefined);
  check('ไม่ล็อกอิน openShiftAction → ไม่สำเร็จ', !a.text.includes('"ok":true'));
  a = await act('openShiftAction', { openingCash: '-5' }, at);
  check('เงินทอนติดลบ → ปฏิเสธ', a.text.includes('ไม่ถูกต้อง') && !a.text.includes('"ok":true'));
  a = await act('closeShiftAction', { shiftId: '00000000-0000-4000-8000-000000000000', countedCash: '10' }, ct);
  check('ปิดกะที่ไม่มีจริง → ปฏิเสธ', a.text.includes('ไม่พบกะ'));
  if (hasOpen) {
    console.log('ข้าม flow เปิด/ปิดกะจริง: มีกะที่เปิดอยู่ใน DB อยู่แล้ว (ไม่แตะข้อมูลจริง)');
  } else {
    const before = await db.shift.count();
    a = await act('openShiftAction', { openingCash: '500' }, ct);
    check('CASHIER เปิดกะได้', a.text.includes('"ok":true'), a.text.slice(0, 120));
    const sh = await db.shift.findFirst({ where: { status: 'OPEN' } });
    a = await act('openShiftAction', { openingCash: '700' }, at);
    check('เปิดกะซ้อนไม่ได้', a.text.includes('มีกะที่เปิดอยู่แล้ว'));
    a = await act('closeShiftAction', { shiftId: sh.id, countedCash: '450' }, at);
    check('นับไม่ตรงโดยไม่ใส่หมายเหตุ → ปฏิเสธ', a.text.includes('ระบุหมายเหตุ'));
    a = await act('closeShiftAction', { shiftId: sh.id, countedCash: '450', note: 'ทดสอบ guard' }, at);
    check('ปิดกะพร้อมหมายเหตุสำเร็จ (เงินขาด 50)', a.text.includes('"ok":true') && a.text.includes('-50.00'), a.text.slice(0, 160));
    a = await act('closeShiftAction', { shiftId: sh.id, countedCash: '450', note: 'ซ้ำ' }, at);
    check('ปิดกะซ้ำไม่ได้', a.text.includes('ปิดไปแล้ว'));
    // ล้างข้อมูลทดสอบ
    await db.auditLog.deleteMany({ where: { entityId: sh.id, action: { in: ['SHIFT_OPEN', 'SHIFT_CLOSE'] } } });
    await db.shift.delete({ where: { id: sh.id } });
    check('ล้างข้อมูลกะทดสอบแล้ว', (await db.shift.count()) === before);
  }
  await db.auditLog.deleteMany({ where: { action: 'REPORT_EXPORT', userId: admin.id, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } });
}

// 4i) รายการสั่งซื้อ + CSV restock + หน้าที่เรียงได้ + ช่วงวันที่ Dashboard (v1.5)
{
  let r = await get('/reports/export?type=restock');
  check('ไม่ล็อกอิน: CSV restock → redirect /login', r.status >= 300 && r.status < 400 && loc(r).includes('/login'), `${r.status}`);
  r = await get('/reports/export?type=restock', ct);
  check('CASHIER: CSV restock → 403', r.status === 403, `${r.status}`);
  r = await get('/reports/export?type=restock', at);
  const buf = new Uint8Array(await r.arrayBuffer());
  check('ADMIN: CSV restock → 200 text/csv + BOM', r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv') && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, `${r.status}`);
  check('CSV restock มีหัวคอลัมน์ "จำนวนที่ควรสั่ง"', new TextDecoder().decode(buf).includes('จำนวนที่ควรสั่ง'));
  r = await get('/reports/export?type=daily', at);
  check('CSV daily ที่ไม่ใส่ from/to → 400 (ยังตรวจพารามิเตอร์)', r.status === 400, `${r.status}`);
  check('CASHIER เข้า /inventory/reorder → redirect', (await body('/inventory/reorder', ct)).includes('NEXT_REDIRECT'));
  check('ADMIN เข้า /inventory/reorder ได้', (await get('/inventory/reorder', at)).status === 200);
  for (const p of ['/categories?sort=count&dir=desc', '/promotions?sort=discount&dir=desc', '/users?sort=name&dir=asc', '/shifts?sort=diff&dir=desc', '/products?sort=evil&dir=zzz', '/dashboard?from=2026-01-01&to=2026-01-31', '/dashboard?from=bad&to=worse', '/dashboard?from=2099-01-01&to=2099-02-01']) {
    check(`ADMIN เปิด ${p} ได้ (ค่าแปลกไม่ทำให้ error)`, (await get(p, at)).status === 200);
  }
  check('CASHIER เข้า /categories?sort=name → redirect', (await body('/categories?sort=name&dir=asc', ct)).includes('NEXT_REDIRECT'));
  await db.auditLog.deleteMany({ where: { action: 'REPORT_EXPORT', userId: admin.id, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } });
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
