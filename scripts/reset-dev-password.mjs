// รีเซ็ตรหัสผ่าน admin ของ "ฐาน dev" (ค่าใน .env เท่านั้น — ไม่สนใจตัวแปรใน terminal จึงไม่มีทางแตะ production)
// ใช้ใน PowerShell:
//   $env:NEW_PASSWORD = "รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)"
//   node scripts/reset-dev-password.mjs
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }),
);
const pw = process.env.NEW_PASSWORD ?? "";
if (pw.length < 8) {
  console.error("ตั้ง $env:NEW_PASSWORD ก่อน (อย่างน้อย 8 ตัวอักษร)");
  process.exit(1);
}
const url = env.DATABASE_URL;
console.log("ฐานปลายทาง (จาก .env):", new URL(url).host);
const db = new PrismaClient({ datasources: { db: { url } } });
try {
  const r = await db.user.update({ where: { email: "admin@smartmart.local" }, data: { passwordHash: await bcrypt.hash(pw, 10) }, select: { email: true } });
  console.log("เปลี่ยนรหัสผ่านของ", r.email, "แล้ว");
} finally {
  await db.$disconnect();
}
