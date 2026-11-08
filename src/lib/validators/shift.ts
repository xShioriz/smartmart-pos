import { z } from "zod";

const money = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, `${label}ไม่ถูกต้อง (ตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง)`));

export const openShiftSchema = z.object({ openingCash: money("เงินทอนตั้งต้น") });

export const closeShiftSchema = z.object({
  shiftId: z.string().uuid("กะไม่ถูกต้อง"),
  countedCash: money("เงินที่นับได้"),
  note: z.string().trim().max(300, "หมายเหตุยาวเกินไป").optional().transform((x) => (x ? x : null)),
});
