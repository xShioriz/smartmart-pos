// ตรวจความพร้อมก่อน/หลัง deploy โดยไม่พิมพ์ค่า secret ใด ๆ
// ใช้:  npx tsx scripts/check-deploy.mts
// อ่านค่าจาก environment ของ terminal ก่อน แล้วค่อย fallback ไปที่ .env
// ถ้าตั้ง DATABASE_URL/DIRECT_URL ของ production ใน terminal ไว้ สคริปต์จะตรวจฐาน production
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const shellKeys = new Set(Object.keys(process.env));
const fileEnv: Record<string, string> = {};
if (fs.existsSync(".env")) {
  for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!/^[A-Z_]+=/.test(l)) continue;
    const i = l.indexOf("=");
    fileEnv[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
  }
}
for (const [k, v] of Object.entries(fileEnv)) process.env[k] ??= v;

let fails = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { fails++; console.log(`  ✗ ${m}`); };
const warn = (m: string) => console.log(`  ! ${m}`);
const hostOf = (u?: string) => { try { return new URL(u ?? "").host; } catch { return null; } };

console.log("1) Environment (ไม่แสดงค่า)");
for (const k of ["DATABASE_URL", "DIRECT_URL", "SESSION_SECRET"]) (process.env[k] ? ok : bad)(`${k} ${process.env[k] ? "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"}`);
if ((process.env.SESSION_SECRET ?? "").length >= 32) ok("SESSION_SECRET ยาว ≥ 32 ตัวอักษร"); else bad("SESSION_SECRET สั้นกว่า 32 ตัวอักษร");
const mode = process.env.PAYMENT_ENV ?? "sandbox";
ok(`PAYMENT_ENV = ${mode}`);
const sk = process.env.PAYMENT_SANDBOX_SECRET_KEY ?? "";
if (mode === "sandbox") (sk.startsWith("skey_test_") ? ok : bad)(sk ? "PAYMENT_SANDBOX_SECRET_KEY เป็น test key" : "ยังไม่ได้ตั้ง PAYMENT_SANDBOX_SECRET_KEY (QR จะปิดใช้งาน)");
if (mode === "production") warn("PAYMENT_ENV=production ต้องมี merchant account จริงและ live key — โปรเจกต์นี้ใช้ sandbox");
if (!process.env.PAYMENT_WEBHOOK_SECRET) warn("ไม่ได้ตั้ง PAYMENT_WEBHOOK_SECRET (ระบบยังยืนยันการจ่ายด้วยการเรียก API ของ Provider ซ้ำ จึงปลอดภัย)");

console.log("2) ฐานข้อมูลปลายทาง");
const target = hostOf(process.env.DATABASE_URL);
const devHost = hostOf(fileEnv.DATABASE_URL);
console.log(`  host: ${target ?? "(อ่านไม่ได้)"}`);
if (shellKeys.has("DATABASE_URL") && devHost && target !== devHost) ok("ชี้ไปคนละฐานกับ .env (dev) — น่าจะเป็น production");
else if (devHost && target === devHost) warn("ชี้ไปฐานเดียวกับ .env (dev)");

const db = new PrismaClient();
try {
  const applied = await db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM "_prisma_migrations"`;
  const dir = path.join("prisma", "migrations");
  const local = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory()).sort();
  const done = new Set(applied.filter((a) => a.finished_at).map((a) => a.migration_name));
  const missing = local.filter((m) => !done.has(m));
  (missing.length === 0 ? ok : bad)(missing.length === 0 ? `migration ครบ ${local.length} รายการ` : `migration ยังไม่ครบ: ${missing.join(", ")} (รัน npx prisma migrate deploy)`);

  const [users, products, sales] = await Promise.all([db.user.count(), db.product.count(), db.sale.count()]);
  console.log(`  ผู้ใช้ ${users}, สินค้า ${products}, บิล ${sales}`);
  (users >= 1 ? ok : bad)(users >= 1 ? "มีผู้ใช้แล้ว" : "ยังไม่มีผู้ใช้ (รัน npx prisma db seed)");

  const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId" = p.id), 0)`;
  (Number(drift[0].n) === 0 ? ok : bad)(`สต็อกในสินค้ากับผลรวมล็อตตรงกัน (ต่างกัน ${drift[0].n} รายการ)`);
  const noAdmin = await db.user.count({ where: { role: "ADMIN", isActive: true } });
  (noAdmin >= 1 ? ok : bad)(`มี ADMIN ที่ใช้งานได้ ${noAdmin} คน`);
} catch (e) {
  bad(`เชื่อมต่อ/ตรวจฐานข้อมูลไม่ได้: ${e instanceof Error ? e.message.split("\n").pop() : e}`);
} finally {
  await db.$disconnect();
}

console.log(fails === 0 ? "\nผ่านทุกข้อ" : `\nไม่ผ่าน ${fails} ข้อ`);
process.exit(fails === 0 ? 0 : 1);
