"use server";

import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/validators/auth";
import { authenticate } from "@/server/services/auth";
import { createSession, deleteSession } from "@/server/auth/session";
import { homePathFor } from "@/server/auth/guard";

export type LoginState = { error?: string } | undefined;

const INVALID = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: INVALID };
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { error: INVALID };
  await createSession(user.id);
  redirect(homePathFor(user.role));
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
