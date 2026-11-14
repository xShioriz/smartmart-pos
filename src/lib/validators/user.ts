import { z } from "zod";

const email = z.string().trim().toLowerCase().email("อีเมลไม่ถูกต้อง").max(120);
const name = z.string().trim().min(1, "กรุณากรอกชื่อ").max(80);
const role = z.enum(["ADMIN", "OWNER", "CASHIER"]);
const password = z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัวอักษร").max(100);

export const createUserSchema = z.object({ email, name, role, password });
export const updateUserSchema = z.object({ id: z.string().uuid(), name, role });
export const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });
export const resetPasswordSchema = z.object({ id: z.string().uuid(), password });
