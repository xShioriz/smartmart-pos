import { z } from "zod";
import { MAX_LINE_QTY, MAX_LINES } from "@/server/services/checkout";

export const checkoutCashSchema = z.object({
  idempotencyKey: z.string().uuid("รหัสคำขอไม่ถูกต้อง"),
  items: z
    .array(
      z.object({
        productId: z.string().uuid("สินค้าไม่ถูกต้อง"),
        quantity: z.coerce.number({ error: "จำนวนไม่ถูกต้อง" }).int("จำนวนต้องเป็นจำนวนเต็ม").min(1, "จำนวนต้องมากกว่า 0").max(MAX_LINE_QTY, `จำนวนต่อรายการต้องไม่เกิน ${MAX_LINE_QTY}`),
      }),
    )
    .min(1, "ตะกร้าว่างเปล่า")
    .max(MAX_LINES, `รายการสินค้าเกิน ${MAX_LINES} รายการ`),
  amountPaid: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "จำนวนเงินที่รับไม่ถูกต้อง")),
});
