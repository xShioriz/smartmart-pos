"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { adjustStockSchema, notificationIdSchema, receiveStockSchema } from "@/lib/validators/inventory";
import * as ops from "@/server/services/stock-ops";
import { markAllNotificationsRead, markNotificationRead } from "@/server/services/notifications";

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

export async function markNotificationReadAction(input: unknown) {
  return runAction(async () => {
    await requireAction(["ADMIN"]);
    await markNotificationRead(notificationIdSchema.parse(input).id);
    revalidatePath("/inventory", "layout");
  });
}

export async function markAllNotificationsReadAction() {
  return runAction(async () => {
    await requireAction(["ADMIN"]);
    await markAllNotificationsRead();
    revalidatePath("/inventory", "layout");
  });
}
