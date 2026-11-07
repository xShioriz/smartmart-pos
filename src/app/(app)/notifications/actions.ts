"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { notificationIdSchema } from "@/lib/validators/inventory";
import { markAllNotificationsRead, markNotificationRead } from "@/server/services/notifications";

export async function markNotificationReadAction(input: unknown) {
  return runAction(async () => {
    await requireAction(["ADMIN"]);
    await markNotificationRead(notificationIdSchema.parse(input).id);
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  });
}

export async function markAllNotificationsReadAction() {
  return runAction(async () => {
    await requireAction(["ADMIN"]);
    await markAllNotificationsRead();
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  });
}
