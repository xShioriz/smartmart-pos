"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { resolveReviewSchema } from "@/lib/validators/checkout";
import { resolveReviewSale } from "@/server/services/payments";

export async function resolveReviewAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await resolveReviewSale(actor, resolveReviewSchema.parse(input));
    revalidatePath("/sales", "layout");
    revalidatePath("/inventory", "layout");
  });
}
