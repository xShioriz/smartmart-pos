import { z } from "zod";

const line = z.object({
  saleItemId: z.string().uuid("รายการสินค้าไม่ถูกต้อง"),
  quantity: z.coerce.number({ error: "จำนวนไม่ถูกต้อง" }).int("จำนวนต้องเป็นจำนวนเต็ม").min(0, "จำนวนต้องไม่ติดลบ").max(9999, "จำนวนมากเกินไป"),
  restock: z.boolean().default(true),
});

const items = z.array(line).min(1, "กรุณาเลือกสินค้าที่จะคืน").max(100);

export const previewReturnSchema = z.object({ saleId: z.string().uuid(), items });

export const returnSaleSchema = z.object({
  saleId: z.string().uuid(),
  items,
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลการคืนสินค้า").max(200, "เหตุผลยาวเกินไป"),
  refundNote: z.string().trim().max(200, "หมายเหตุยาวเกินไป").default("").transform((v) => v || null),
  idempotencyKey: z.string().uuid("รหัสคำขอไม่ถูกต้อง"),
});
