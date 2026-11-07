import { z } from "zod";

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "จำนวนไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)"));

/** รับ "yyyy-MM-ddTHH:mm" (จาก datetime-local) แล้วตีความเป็นเวลาไทย */
const bangkokDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "วันเวลาไม่ถูกต้อง")
  .transform((v, ctx) => {
    const d = new Date(`${v}:00+07:00`);
    if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: "custom", message: "วันเวลาไม่ถูกต้อง" }); return z.NEVER; }
    return d;
  });

const base = {
  name: z.string().trim().min(1, "กรุณากรอกชื่อโปรโมชั่น").max(100, "ชื่อยาวเกินไป"),
  scope: z.enum(["PRODUCT", "CATEGORY", "BILL"]),
  discountType: z.enum(["PERCENT", "FIXED"]),
  value: money,
  productId: z.string().default("").transform((v) => v || null),
  categoryId: z.string().default("").transform((v) => v || null),
  minPurchase: z.union([z.string(), z.number()]).default("").transform((v) => String(v).trim()).pipe(z.union([z.literal(""), z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "ยอดขั้นต่ำไม่ถูกต้อง")])).transform((v) => v || null),
  startsAt: bangkokDateTime,
  endsAt: bangkokDateTime,
};

function refine<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((v: z.infer<T>, ctx) => {
    const d = v as { scope: string; discountType: string; value: string; productId: string | null; categoryId: string | null; minPurchase: string | null; startsAt: Date; endsAt: Date };
    const value = Number(d.value);
    if (!(value > 0)) ctx.addIssue({ code: "custom", path: ["value"], message: "ส่วนลดต้องมากกว่า 0" });
    if (d.discountType === "PERCENT" && value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "เปอร์เซ็นต์ต้องไม่เกิน 100" });
    if (d.scope === "PRODUCT" && !d.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "กรุณาเลือกสินค้า" });
    if (d.scope === "CATEGORY" && !d.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "กรุณาเลือกหมวดหมู่" });
    if (d.scope !== "BILL" && d.minPurchase) ctx.addIssue({ code: "custom", path: ["minPurchase"], message: "ยอดขั้นต่ำใช้กับโปรทั้งบิลเท่านั้น" });
    if (d.startsAt instanceof Date && d.endsAt instanceof Date && !(d.endsAt.getTime() > d.startsAt.getTime())) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "วันสิ้นสุดต้องหลังวันเริ่มต้น" });
  });
}

export const createPromotionSchema = refine(z.object(base));
export const updatePromotionSchema = refine(z.object({ id: z.string().uuid(), ...base }));
export const setPromotionActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });
