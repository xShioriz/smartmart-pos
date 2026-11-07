"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { settingsSchema } from "@/lib/validators/settings";
import { updateSettings } from "@/server/services/settings";

export async function updateSettingsAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    const r = await updateSettings(actor, settingsSchema.parse(input));
    revalidatePath("/", "layout");
    return r;
  });
}
