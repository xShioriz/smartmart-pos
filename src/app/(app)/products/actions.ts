"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { createProductSchema, setProductActiveSchema, updateProductSchema } from "@/lib/validators/product";
import * as products from "@/server/services/products";

export async function createProductAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await products.createProduct(actor, createProductSchema.parse(input));
    revalidatePath("/products");
  });
}

export async function updateProductAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await products.updateProduct(actor, updateProductSchema.parse(input));
    revalidatePath("/products");
  });
}

export async function setProductActiveAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await products.setProductActive(actor, setProductActiveSchema.parse(input));
    revalidatePath("/products");
  });
}
