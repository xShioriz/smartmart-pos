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
