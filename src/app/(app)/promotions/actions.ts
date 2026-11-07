"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { createPromotionSchema, setPromotionActiveSchema, updatePromotionSchema } from "@/lib/validators/promotion";
import * as promotions from "@/server/services/promotions";

export async function createPromotionAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await promotions.createPromotion(actor, createPromotionSchema.parse(input));
    revalidatePath("/promotions");
  });
}

export async function updatePromotionAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await promotions.updatePromotion(actor, updatePromotionSchema.parse(input));
    revalidatePath("/promotions");
  });
}

export async function setPromotionActiveAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await promotions.setPromotionActive(actor, setPromotionActiveSchema.parse(input));
    revalidatePath("/promotions");
  });
}
