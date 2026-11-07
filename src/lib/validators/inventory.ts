import { z } from "zod";
import { optionalDate } from "./product";

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "จำนวนเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)"));

const qty = (label: string, min: number) =>
  z.coerce.number({ error: `${label}ไม่ถูกต้อง` }).int(`${label}ต้องเป็นจำนวนเต็ม`).min(min, min > 0 ? `${label}ต้องมากกว่า 0` : `${label}ต้องไม่ติดลบ`).max(1_000_000, `${label}มากเกินไป`);

export const receiveStockSchema = z.object({
  productId: z.string().uuid(),
  qty: qty("จำนวนรับเข้า", 1),
  costPrice: money,
  expiryDate: optionalDate,
  batchNo: z.string().trim().max(40, "เลขล็อตยาวเกินไป").default("").transform((v) => v || null),
  note: z.string().trim().max(200, "หมายเหตุยาวเกินไป").default("").transform((v) => v || null),
});

export const adjustStockSchema = z.object({
  batchId: z.string().uuid(),
  mode: z.enum(["ADD", "REMOVE", "SET"]),
  qty: qty("จำนวน", 0),
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลการปรับสต็อก").max(200, "เหตุผลยาวเกินไป"),
});

export const notificationIdSchema = z.object({ id: z.string().uuid() });
