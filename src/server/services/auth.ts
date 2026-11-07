import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { audit } from "@/server/audit";

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
