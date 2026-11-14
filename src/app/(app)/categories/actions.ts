"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { createCategorySchema, deleteCategorySchema, updateCategorySchema } from "@/lib/validators/category";
import * as categories from "@/server/services/categories";

export async function createCategoryAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    await categories.createCategory(actor, createCategorySchema.parse(input));
    revalidatePath("/categories");
  });
}

export async function updateCategoryAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    await categories.updateCategory(actor, updateCategorySchema.parse(input));
    revalidatePath("/categories");
  });
}

export async function deleteCategoryAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    await categories.deleteCategory(actor, deleteCategorySchema.parse(input).id);
    revalidatePath("/categories");
  });
}
