"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { createMemberSchema, setMemberActiveSchema, updateMemberSchema } from "@/lib/validators/member";
import * as members from "@/server/services/members";

export async function createMemberAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    const r = await members.createMember(actor, createMemberSchema.parse(input));
    revalidatePath("/members");
    return { code: r.code };
  });
}

export async function updateMemberAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    await members.updateMember(actor, updateMemberSchema.parse(input));
    revalidatePath("/members", "layout");
  });
}

export async function setMemberActiveAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    await members.setMemberActive(actor, setMemberActiveSchema.parse(input));
    revalidatePath("/members", "layout");
  });
}
