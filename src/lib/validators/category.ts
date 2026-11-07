import { z } from "zod";

const name = z.string().trim().min(1, "กรุณากรอกชื่อหมวดหมู่").max(60, "ชื่อยาวเกินไป");
const description = z.string().trim().max(200, "คำอธิบายยาวเกินไป").default("").transform((v) => v || null);

export const createCategorySchema = z.object({ name, description });
export const updateCategorySchema = z.object({ id: z.string().uuid(), name, description });
export const deleteCategorySchema = z.object({ id: z.string().uuid() });
