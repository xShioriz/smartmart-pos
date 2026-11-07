"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { createUserSchema, resetPasswordSchema, setActiveSchema, updateUserSchema } from "@/lib/validators/user";
import * as users from "@/server/services/users";

// ทุก action: requireAction(["ADMIN"]) ก่อนเสมอ → Zod → service
export async function createUserAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await users.createUser(actor, createUserSchema.parse(input));
    revalidatePath("/users");
  });
}

export async function updateUserAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await users.updateUser(actor, updateUserSchema.parse(input));
    revalidatePath("/users");
  });
}

export async function setUserActiveAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await users.setUserActive(actor, setActiveSchema.parse(input));
    revalidatePath("/users");
  });
}

export async function resetPasswordAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await users.resetPassword(actor, resetPasswordSchema.parse(input));
  });
}
