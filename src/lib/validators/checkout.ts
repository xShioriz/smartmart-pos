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
  memberId: z.string().uuid("สมาชิกไม่ถูกต้อง").nullish().transform((x) => x ?? null),
  expectedTotal: z
    .union([z.string(), z.number()])
    .transform((x) => String(x).trim())
    .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "ยอดรวมไม่ถูกต้อง")),
  amountPaid: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "จำนวนเงินที่รับไม่ถูกต้อง")),
});

export const startQrSchema = checkoutCashSchema.omit({ amountPaid: true });
export const paymentIdSchema = z.object({ paymentId: z.string().uuid("รายการชำระเงินไม่ถูกต้อง") });
export const resolveReviewSchema = z.object({
  saleId: z.string().uuid(),
  action: z.enum(["FULFILL", "REFUNDED"]),
  note: z.string().trim().min(1, "กรุณาระบุหมายเหตุ").max(200, "หมายเหตุยาวเกินไป"),
});

export const quoteSchema = z.object({
  items: checkoutCashSchema.shape.items,
  memberId: checkoutCashSchema.shape.memberId,
});
export const memberSearchSchema = z.object({ q: z.string().trim().max(60) });
