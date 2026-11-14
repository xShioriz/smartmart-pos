import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { checkLoginAllowed, clearLoginFailures, lockedMessage, recordLoginFailure } from "@/server/services/login-throttle";

// ใช้เทียบเวลาเมื่อไม่พบผู้ใช้ เพื่อไม่ให้เดาได้ว่าอีเมลมีอยู่ในระบบ
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", 10));

export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
  if (!user || !ok || !user.isActive) {
    await audit(db, { action: "LOGIN_FAILED", entity: "User", entityId: user?.id ?? null, after: { email } });
    return null;
  }
  return { id: user.id, role: user.role };
}

export type LoginOutcome = { ok: true; user: { id: string; role: "ADMIN" | "OWNER" | "CASHIER" } } | { ok: false; error: string; locked: boolean };

export const INVALID_LOGIN = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

/** ล็อกอินพร้อมจำกัดการลองผิดซ้ำ — ถ้าถูกบล็อกจะไม่ตรวจรหัสผ่านเลย (ตอบแบบเดียวกันทั้งอีเมลที่มีและไม่มีในระบบ) */
export async function attemptLogin(email: string, password: string, ip: string, now = new Date()): Promise<LoginOutcome> {
  const gate = await checkLoginAllowed(email, ip, now);
  if (!gate.allowed) return { ok: false, error: lockedMessage(gate.retryAfterSec), locked: true };
  const user = await authenticate(email, password);
  if (!user) {
    await recordLoginFailure(email, ip, now);
    return { ok: false, error: INVALID_LOGIN, locked: false };
  }
  await clearLoginFailures(email, ip);
  return { ok: true, user };
}
