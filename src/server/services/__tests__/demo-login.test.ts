// Integration test: โหมดสาธิตล็อกอิน (ต่อ DB dev; ข้อมูลทดสอบขึ้นต้น zzdemo และถูกลบเมื่อจบ)
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { demoLogin, demoLoginEnabled } from "@/server/services/auth";

const TAG = `zzdemo${Date.now().toString(36)}`;
const emailOf = (r: string) => `${TAG}-${r}@smartmart.test`;
const ids: string[] = [];
const prev = process.env.DEMO_LOGIN_EMAIL;

const mk = async (r: Role, isActive = true, key = r.toLowerCase()) => {
  const u = await db.user.create({ data: { email: emailOf(key), name: `${TAG} ${key}`, passwordHash: "x", role: r, isActive } });
  ids.push(u.id);
  return u;
};

beforeAll(async () => {
  await mk("OWNER");
  await mk("ADMIN");
  await mk("CASHIER");
  await mk("OWNER", false, "owner-off");
});
afterEach(() => { process.env.DEMO_LOGIN_EMAIL = prev; if (prev === undefined) delete process.env.DEMO_LOGIN_EMAIL; });
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("demo login", () => {
  it("ไม่ตั้ง DEMO_LOGIN_EMAIL = ปิด ล็อกอินไม่ได้", async () => {
    delete process.env.DEMO_LOGIN_EMAIL;
    expect(demoLoginEnabled()).toBe(false);
    expect(await demoLogin()).toBeNull();
  });

  it("ตั้งเป็นผู้ใช้ OWNER ที่เปิดใช้งาน → ล็อกอินได้และบันทึก audit", async () => {
    process.env.DEMO_LOGIN_EMAIL = emailOf("owner");
    expect(demoLoginEnabled()).toBe(true);
    const r = await demoLogin();
    expect(r?.role).toBe("OWNER");
    const log = await db.auditLog.findFirst({ where: { userId: r!.id, action: "LOGIN_DEMO" } });
    expect(log).not.toBeNull();
  });

  it.each(["admin", "cashier", "owner-off", "no-such-user"])("ตั้งเป็น %s → ปฏิเสธ (ยอมเฉพาะ OWNER ที่เปิดใช้งาน)", async (k) => {
    process.env.DEMO_LOGIN_EMAIL = emailOf(k);
    expect(await demoLogin()).toBeNull();
  });
});
