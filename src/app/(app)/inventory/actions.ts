"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { adjustStockSchema, receiveStockSchema } from "@/lib/validators/inventory";
import * as ops from "@/server/services/stock-ops";

function refresh() {
  revalidatePath("/inventory", "layout");
  revalidatePath("/products");
}

export async function receiveStockAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await ops.receiveStock(actor, receiveStockSchema.parse(input));
    refresh();
  });
}

export async function adjustStockAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await ops.adjustStock(actor, adjustStockSchema.parse(input));
    refresh();
  });
}
