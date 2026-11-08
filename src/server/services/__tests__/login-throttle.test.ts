// จำกัดการล็อกอินผิดซ้ำ — integration test กับ DB dev (ข้อมูลขึ้นต้น zz และถูกลบเมื่อจบ)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { attemptLogin } from "@/server/services/auth";
import { MAX_PER_EMAIL, MAX_PER_EMAIL_IP, MAX_PER_IP, WINDOW_MS, checkLoginAllowed, recordLoginFailure } from "@/server/services/login-throttle";

const TAG = `zz${Date.now().toString(36)}`;
const PASSWORD = "Correct-horse-1";
const email = (n: string) => `${TAG}-${n}@test.local`;
let userId: string;

beforeAll(async () => {
  userId = (await db.user.create({ data: { email: email("user"), name: `${TAG} ทดสอบ`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: "CASHIER" } })).id;
});

afterAll(async () => {
  await db.loginAttempt.deleteMany({ where: { OR: [{ email: { startsWith: TAG } }, { ip: { startsWith: TAG } }] } });
  await db.$executeRaw`DELETE FROM "AuditLog" WHERE action IN ('LOGIN_FAILED','LOGIN_LOCKED') AND (after->>'email') LIKE ${TAG + "%"}`;
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

const fail = (e: string, ip: string, now?: Date) => attemptLogin(e, "wrong-password", ip, now);

describe("จำกัดการล็อกอินผิดซ้ำ", () => {
  it("ผิดน้อยกว่าเกณฑ์ยังล็อกอินได้ และถูกต้องเข้าได้", async () => {
    const ip = `${TAG}-ip1`;
    for (let i = 0; i < MAX_PER_EMAIL_IP - 1; i++) {
      const r = await fail(email("user"), ip);
      expect(r).toMatchObject({ ok: false, locked: false });
    }
    const ok = await attemptLogin(email("user"), PASSWORD, ip);
    expect(ok.ok).toBe(true);
  });

  it("ล็อกอินสำเร็จแล้วล้างประวัติผิด (ผิดอีก 4 ครั้งก็ยังไม่ถูกบล็อก)", async () => {
    const ip = `${TAG}-ip1`;
    expect(await db.loginAttempt.count({ where: { email: email("user"), ip } })).toBe(0);
    for (let i = 0; i < MAX_PER_EMAIL_IP - 1; i++) expect(await fail(email("user"), ip)).toMatchObject({ locked: false });
    await attemptLogin(email("user"), PASSWORD, ip);
  });

  it("ผิดครบเกณฑ์ → ถูกบล็อก แม้ใส่รหัสผ่านถูกก็เข้าไม่ได้ และบอกเวลารอ", async () => {
    const ip = `${TAG}-ip2`;
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) await fail(email("user"), ip);
    const r = await attemptLogin(email("user"), PASSWORD, ip);
    expect(r).toMatchObject({ ok: false, locked: true });
    if (!r.ok) expect(r.error).toMatch(/รออีกประมาณ \d+ นาที/);
    const gate = await checkLoginAllowed(email("user"), ip);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.retryAfterSec).toBeGreaterThan(14 * 60);
  });

  it("บันทึก audit LOGIN_LOCKED เฉพาะครั้งที่ทำให้ถูกล็อก (1 ครั้ง) ไม่ใช่ทุกครั้งที่ถูกบล็อก", async () => {
    const ip = `${TAG}-ip3`;
    for (let i = 0; i < MAX_PER_EMAIL_IP + 3; i++) await fail(email("user"), ip);
    const n = await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) c FROM "AuditLog" WHERE action='LOGIN_LOCKED' AND after->>'ip' = ${ip}`;
    expect(Number(n[0].c)).toBe(1);
  });

  it("ถูกบล็อกแล้วไม่เพิ่มจำนวนครั้งที่ผิด (ไม่ต่ออายุการล็อกไปเรื่อย ๆ)", async () => {
    const ip = `${TAG}-ip4`;
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) await fail(email("user"), ip);
    const before = await db.loginAttempt.count({ where: { ip } });
    for (let i = 0; i < 5; i++) await fail(email("user"), ip);
    expect(await db.loginAttempt.count({ where: { ip } })).toBe(before);
  });

  it("IP อื่นของอีเมลเดียวกันไม่ถูกบล็อก (คนอื่นล็อกบัญชีเราไม่ได้ง่าย ๆ)", async () => {
    const r = await attemptLogin(email("user"), PASSWORD, `${TAG}-ip-other`);
    expect(r.ok).toBe(true);
  });

  it("อีเมลที่ไม่มีในระบบ: พฤติกรรมเหมือนกัน (บล็อกที่เกณฑ์เดียวกัน ไม่เปิดเผยว่ามีบัญชีหรือไม่)", async () => {
    const ip = `${TAG}-ip5`;
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) expect(await fail(email("ghost"), ip)).toMatchObject({ locked: false });
    expect(await fail(email("ghost"), ip)).toMatchObject({ locked: true });
  });

  it("อีเมลตัวพิมพ์ใหญ่/เว้นวรรคนับเป็นอีเมลเดียวกัน (เลี่ยงด้วยการสลับตัวพิมพ์ไม่ได้)", async () => {
    const ip = `${TAG}-ip6`;
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) await recordLoginFailure(i % 2 ? email("case").toUpperCase() : ` ${email("case")} `, ip);
    expect((await checkLoginAllowed(email("case"), ip)).allowed).toBe(false);
  });

  it("เกินกำหนดเวลา (15 นาที) → ปลดบล็อกเอง", async () => {
    const ip = `${TAG}-ip7`;
    const t0 = new Date();
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) await recordLoginFailure(email("user"), ip, t0);
    expect((await checkLoginAllowed(email("user"), ip, new Date(t0.getTime() + WINDOW_MS - 5000))).allowed).toBe(false);
    expect((await checkLoginAllowed(email("user"), ip, new Date(t0.getTime() + WINDOW_MS + 1000))).allowed).toBe(true);
  });

  it("เวลารอคำนวณจากครั้งที่ทำให้ติดบล็อก (ผิด 5 ครั้งห่างกัน: ปลดเมื่อครั้งเก่าสุดหลุดหน้าต่าง)", async () => {
    const ip = `${TAG}-ip8`;
    const t0 = Date.now() - 10 * 60 * 1000; // ผิดมาแล้วเมื่อ 10 นาทีก่อน
    for (let i = 0; i < MAX_PER_EMAIL_IP; i++) await recordLoginFailure(email("user"), ip, new Date(t0 + i * 1000));
    const g = await checkLoginAllowed(email("user"), ip);
    expect(g.allowed).toBe(false);
    if (!g.allowed) {
      expect(g.retryAfterSec).toBeGreaterThan(4 * 60);
      expect(g.retryAfterSec).toBeLessThan(5 * 60 + 5);
    }
  });

  it("IP เดียวเดาหลายบัญชีครบ MAX_PER_IP → ทุกบัญชีจาก IP นั้นถูกบล็อก", async () => {
    const ip = `${TAG}-ip9`;
    for (let i = 0; i < MAX_PER_IP; i++) await recordLoginFailure(email(`many${i}`), ip);
    expect((await checkLoginAllowed(email("fresh"), ip)).allowed).toBe(false);
    expect((await checkLoginAllowed(email("fresh"), `${TAG}-clean`)).allowed).toBe(true);
  });

  it("อีเมลเดียวถูกเดาจากหลาย IP ครบ MAX_PER_EMAIL → บล็อกทุก IP", async () => {
    const e = email("target");
    for (let i = 0; i < MAX_PER_EMAIL; i++) await recordLoginFailure(e, `${TAG}-src${i}`);
    expect((await checkLoginAllowed(e, `${TAG}-new-ip`)).allowed).toBe(false);
    expect((await checkLoginAllowed(email("someone-else"), `${TAG}-new-ip`)).allowed).toBe(true);
  });

  it("การล้มเหลวที่หมดอายุถูกเก็บกวาด (เก่ากว่า 24 ชม.)", async () => {
    const ip = `${TAG}-ip10`;
    await db.loginAttempt.create({ data: { email: email("old"), ip, createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    await recordLoginFailure(email("old2"), ip);
    expect(await db.loginAttempt.count({ where: { email: email("old") } })).toBe(0);
  });
});
