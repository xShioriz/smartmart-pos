// จำกัดการล็อกอินผิดซ้ำ (กันเดารหัสผ่าน) — นับเฉพาะครั้งที่ "ล้มเหลว" ในหน้าต่างเวลา WINDOW_MS
// กฎ (ถูกบล็อกเมื่อข้อใดข้อหนึ่งถึงเกณฑ์):
//  - อีเมล+IP เดียวกันผิดครบ MAX_PER_EMAIL_IP ครั้ง
//  - IP เดียวกันผิดรวมกันครบ MAX_PER_IP ครั้ง (เดาหลายบัญชีจากเครื่องเดียว)
//  - อีเมลเดียวกันผิดครบ MAX_PER_EMAIL ครั้งจากทุก IP (เดากระจายหลาย IP) — เกณฑ์สูงกว่าเพื่อไม่ให้คนอื่นล็อกบัญชีเราได้ง่าย
// ใช้ DB เก็บ เพราะ Vercel เป็น serverless (หน่วยความจำแต่ละ instance ไม่ร่วมกัน)
// ข้อจำกัด: การนับไม่ atomic เต็มรูปแบบ — คำขอที่ยิงพร้อมกันมากอาจเกินเกณฑ์ได้เล็กน้อย ก่อนถูกบล็อกในครั้งถัดไป
import { db } from "@/server/db";
import { audit } from "@/server/audit";

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_EMAIL_IP = 5;
export const MAX_PER_IP = 30;
export const MAX_PER_EMAIL = 25;
const KEEP_MS = 24 * 60 * 60 * 1000;

export const normEmail = (e: string) => e.trim().toLowerCase();

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSec: number };

type Rule = { where: { email?: string; ip?: string }; limit: number };

function rules(email: string, ip: string): Rule[] {
  return [
    { where: { email, ip }, limit: MAX_PER_EMAIL_IP },
    { where: { ip }, limit: MAX_PER_IP },
    { where: { email }, limit: MAX_PER_EMAIL },
  ];
}

/** ตรวจก่อนตรวจรหัสผ่าน: ถูกบล็อกอยู่หรือไม่ และต้องรออีกกี่วินาที */
export async function checkLoginAllowed(emailRaw: string, ip: string, now = new Date()): Promise<ThrottleResult> {
  const email = normEmail(emailRaw);
  const since = new Date(now.getTime() - WINDOW_MS);
  let retryMs = 0;
  for (const rule of rules(email, ip)) {
    const rows = await db.loginAttempt.findMany({
      where: { ...rule.where, createdAt: { gt: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (rows.length >= rule.limit) {
      // ปลดบล็อกเมื่อจำนวนครั้งในหน้าต่างเวลาลดลงต่ำกว่าเกณฑ์ = เมื่อครั้งที่ (count - limit) หลุดออกจากหน้าต่าง
      const pivot = rows[rows.length - rule.limit];
      retryMs = Math.max(retryMs, pivot.createdAt.getTime() + WINDOW_MS - now.getTime());
    }
  }
  return retryMs > 0 ? { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) } : { allowed: true };
}

/** บันทึกความพยายามที่ล้มเหลว (และลงบันทึก audit ครั้งที่ทำให้ถูกล็อก) */
export async function recordLoginFailure(emailRaw: string, ip: string, now = new Date()) {
  const email = normEmail(emailRaw);
  await db.loginAttempt.create({ data: { email, ip, createdAt: now } });
  const since = new Date(now.getTime() - WINDOW_MS);
  const n = await db.loginAttempt.count({ where: { email, ip, createdAt: { gt: since } } });
  if (n === MAX_PER_EMAIL_IP) {
    await audit(db, { action: "LOGIN_LOCKED", entity: "User", after: { email, ip, windowMinutes: WINDOW_MS / 60000 } });
  }
  // เก็บกวาดข้อมูลเก่า (ไม่ต้องรอผลก่อนตอบผู้ใช้)
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_MS) } } });
}

/** ล็อกอินสำเร็จ: ล้างประวัติผิดของคู่อีเมล+IP นี้ */
export async function clearLoginFailures(emailRaw: string, ip: string) {
  await db.loginAttempt.deleteMany({ where: { email: normEmail(emailRaw), ip } });
}

export function lockedMessage(retryAfterSec: number) {
  const min = Math.ceil(retryAfterSec / 60);
  return `ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารออีกประมาณ ${min} นาทีแล้วลองใหม่`;
}
