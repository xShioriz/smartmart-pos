import { z } from "zod";

// เงิน: รับเป็นสตริง/ตัวเลข แต่เก็บเป็นสตริงเพื่อเลี่ยง float → แปลงเป็น Decimal ใน service
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "จำนวนเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)"));

const qty = (label: string) =>
  z.coerce.number({ error: `${label}ไม่ถูกต้อง` }).int(`${label}ต้องเป็นจำนวนเต็ม`).min(0, `${label}ต้องไม่ติดลบ`).max(1_000_000, `${label}มากเกินไป`);

export const optionalDate = z
  .string()
  .trim()
  .default("")
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      ctx.addIssue({ code: "custom", message: "วันที่ไม่ถูกต้อง" });
      return z.NEVER;
    }
    return v;
  });

const productFields = {
  sku: z.string().trim().min(1, "กรุณากรอก SKU").max(40, "SKU ยาวเกินไป").regex(/^[A-Za-z0-9._-]+$/, "SKU ใช้ได้เฉพาะ A-Z, 0-9, . _ -"),
  barcode: z.string().trim().max(50, "บาร์โค้ดยาวเกินไป").regex(/^[A-Za-z0-9-]*$/, "บาร์โค้ดใช้ได้เฉพาะตัวอักษร ตัวเลข และ -").default("").transform((v) => v || null),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสินค้า").max(120, "ชื่อสินค้ายาวเกินไป"),
  categoryId: z.string().uuid("กรุณาเลือกหมวดหมู่"),
  costPrice: money,
  price: money,
  unit: z.string().trim().min(1, "กรุณากรอกหน่วยนับ").max(20, "หน่วยนับยาวเกินไป"),
  minStock: qty("จำนวนขั้นต่ำ"),
};

export const createProductSchema = z.object({
  ...productFields,
  initialQty: qty("สต็อกเริ่มต้น"),
  initialExpiry: optionalDate,
});

export const updateProductSchema = z.object({ id: z.string().uuid(), ...productFields });
export const setProductActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });
