"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/validators/auth";
import { INVALID_LOGIN, attemptLogin } from "@/server/services/auth";
import { createSession, deleteSession } from "@/server/auth/session";
import { homePathFor } from "@/server/auth/guard";

export type LoginState = { error?: string } | undefined;

/** IP ผู้ใช้: บน Vercel ค่า x-forwarded-for ถูกตั้งโดยแพลตฟอร์ม (ผู้ใช้ปลอมไม่ได้) — ถ้าไม่มีให้ใช้ "unknown" รวมเป็นกลุ่มเดียว */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: INVALID_LOGIN };
  const r = await attemptLogin(parsed.data.email, parsed.data.password, await clientIp());
  if (!r.ok) return { error: r.error };
  await createSession(r.user.id);
  redirect(homePathFor(r.user.role));
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
