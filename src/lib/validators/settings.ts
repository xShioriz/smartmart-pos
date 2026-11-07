import { z } from "zod";

const text = (max: number, label: string, required = false) =>
  z.string().trim().max(max, `${label}ยาวเกินไป (ไม่เกิน ${max} ตัวอักษร)`).refine((v) => !required || v.length > 0, `กรุณากรอก${label}`);
const int = (min: number, max: number, label: string) =>
  z.coerce.number({ error: `${label}ไม่ถูกต้อง` }).int(`${label}ต้องเป็นจำนวนเต็ม`).min(min, `${label}ต้องไม่น้อยกว่า ${min}`).max(max, `${label}ต้องไม่เกิน ${max}`);

export const settingsSchema = z.object({
  store_name: text(80, "ชื่อร้าน", true),
  store_address: text(200, "ที่อยู่"),
  store_phone: text(30, "เบอร์โทร"),
  receipt_footer: text(200, "ข้อความท้ายใบเสร็จ"),
  points_per_baht: int(1, 10000, "บาทต่อ 1 แต้ม"),
  near_expiry_days: int(1, 365, "จำนวนวันเตือนใกล้หมดอายุ"),
  qr_expire_minutes: int(2, 60, "เวลาหมดอายุของ QR (นาที)"),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
