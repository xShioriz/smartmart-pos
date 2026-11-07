import { ZodError } from "zod";
import { AuthError } from "@/server/auth/guard";
import { BusinessError, type ActionResult } from "@/lib/result";

/** ครอบ Server Action: แปลงข้อผิดพลาดเป็นผลลัพธ์ที่ UI แสดงได้ ไม่รั่ว stack trace */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) (fieldErrors[String(issue.path[0] ?? "_")] ??= []).push(issue.message);
      return { ok: false, error: e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", fieldErrors };
    }
    if (e instanceof AuthError || e instanceof BusinessError) return { ok: false, error: e.message };
    console.error("[action error]", e);
    return { ok: false, error: "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่" };
  }
}
