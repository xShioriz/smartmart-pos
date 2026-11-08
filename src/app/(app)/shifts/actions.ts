"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { closeShiftSchema, openShiftSchema } from "@/lib/validators/shift";
import { closeShift, openShift } from "@/server/services/shifts";

export async function openShiftAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "CASHIER"]);
    const r = await openShift(actor, openShiftSchema.parse(input));
    revalidatePath("/shifts");
    return r;
  });
}

export async function closeShiftAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "CASHIER"]);
    const r = await closeShift(actor, closeShiftSchema.parse(input));
    revalidatePath("/shifts");
    return r;
  });
}
