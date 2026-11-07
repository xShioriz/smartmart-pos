import { z } from "zod";

const name = z.string().trim().min(1, "กรุณากรอกชื่อ").max(80, "ชื่อยาวเกินไป");
// เบอร์ไทย 10 หลักขึ้นต้น 0 (ตัดช่องว่าง/ขีดก่อนตรวจ)
const phone = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^0\d{9}$/, "เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0"));
const email = z
  .string()
  .trim()
  .max(120, "อีเมลยาวเกินไป")
  .default("")
  .transform((v) => v || null)
  .pipe(z.union([z.null(), z.string().email("อีเมลไม่ถูกต้อง")]));

export const createMemberSchema = z.object({ name, phone, email });
export const updateMemberSchema = z.object({ id: z.string().uuid(), name, phone, email });
export const setMemberActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });
