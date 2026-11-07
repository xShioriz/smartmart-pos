import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { readSession } from "./session";

export type CurrentUser = { id: string; email: string; name: string; role: Role };

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code === "UNAUTHENTICATED" ? "กรุณาเข้าสู่ระบบ" : "ไม่มีสิทธิ์ดำเนินการนี้");
  }
}

/** ผู้ใช้ปัจจุบัน — โหลดจาก DB ทุกคำขอ เพื่อให้การปิดบัญชี/เปลี่ยน role มีผลทันที */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/** ใช้ใน Page/Layout: ไม่ล็อกอิน → /login, ไม่มีสิทธิ์ → หน้าหลักของ role นั้น */
export async function requirePage(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

/** ใช้ใน Server Action / Route Handler: โยน AuthError (ห้ามพึ่งการซ่อนปุ่มใน UI) */
export async function requireAction(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  if (roles && !roles.includes(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

export function homePathFor(role: Role): string {
  return role === "ADMIN" ? "/dashboard" : "/pos";
}
