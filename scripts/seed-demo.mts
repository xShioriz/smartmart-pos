// สร้างข้อมูลสาธิตยอดขายย้อนหลัง (เงินสด) ผ่านระบบจริง
// รัน (ต้องยืนยันเอง):  ALLOW_DEMO_SEED=1 npx tsx scripts/seed-demo.mts [--days 30]
// คำเตือน: เพิ่มข้อมูลถาวรลงฐานที่ DATABASE_URL ใน .env ชี้อยู่ (และปรับสต็อกสินค้าทุกตัว) — ตรวจ host ก่อนรัน
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

if (process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("ยังไม่ได้ยืนยัน: ตั้ง ALLOW_DEMO_SEED=1 เพื่อรัน (สคริปต์นี้เพิ่มข้อมูลถาวรลงฐานข้อมูล)");
  process.exit(1);
}
const host = new URL(process.env.DATABASE_URL!).host;
console.log(`ฐานข้อมูลปลายทาง: ${host}`);

const { generateDemoSales } = await import("../src/server/demo/seed-demo.ts");
const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 30;
const r = await generateDemoSales({ days });
console.log(`สร้างยอดขาย ${r.sales} บิล (ข้าม ${r.skipped}), คืนสินค้า ${r.returns} รายการ, เติมสต็อกรวม ${r.restocked} ชิ้น`);
process.exit(0);
