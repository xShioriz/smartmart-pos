import bcrypt from "bcryptjs";
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";

const userSelect = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } as const;

export function listUsers() {
  return db.user.findMany({ select: userSelect, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
}

async function assertAnotherActiveAdmin(tx: Prisma.TransactionClient, exceptId: string) {
  const count = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: exceptId } } });
  if (count === 0) throw new BusinessError("ต้องมีผู้ดูแลระบบ (ADMIN) ที่ใช้งานอยู่อย่างน้อย 1 คน");
}

export async function createUser(actor: CurrentUser, input: { email: string; name: string; role: Role; password: string }) {
  const exists = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw new BusinessError("อีเมลนี้ถูกใช้แล้ว");
  const passwordHash = await bcrypt.hash(input.password, 10);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
      select: userSelect,
    });
    await audit(tx, { userId: actor.id, action: "USER_CREATE", entity: "User", entityId: user.id, after: { email: user.email, name: user.name, role: user.role } });
    return user;
  });
}

export async function updateUser(actor: CurrentUser, input: { id: string; name: string; role: Role }) {
  return db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.id }, select: userSelect });
    if (!before) throw new BusinessError("ไม่พบผู้ใช้");
    if (before.role !== input.role) {
      if (actor.id === input.id) throw new BusinessError("ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้");
      if (before.role === "ADMIN" && before.isActive) await assertAnotherActiveAdmin(tx, input.id);
    }
    const user = await tx.user.update({ where: { id: input.id }, data: { name: input.name, role: input.role }, select: userSelect });
    await audit(tx, {
      userId: actor.id,
      action: before.role !== user.role ? "USER_ROLE_CHANGE" : "USER_UPDATE",
      entity: "User",
      entityId: user.id,
      before: { name: before.name, role: before.role },
      after: { name: user.name, role: user.role },
    });
    return user;
  });
}

export async function setUserActive(actor: CurrentUser, input: { id: string; isActive: boolean }) {
  return db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: input.id }, select: userSelect });
    if (!before) throw new BusinessError("ไม่พบผู้ใช้");
    if (!input.isActive) {
      if (actor.id === input.id) throw new BusinessError("ไม่สามารถปิดบัญชีของตัวเองได้");
      if (before.role === "ADMIN" && before.isActive) await assertAnotherActiveAdmin(tx, input.id);
    }
    const user = await tx.user.update({ where: { id: input.id }, data: { isActive: input.isActive }, select: userSelect });
    await audit(tx, {
      userId: actor.id,
      action: input.isActive ? "USER_ENABLE" : "USER_DISABLE",
      entity: "User",
      entityId: user.id,
      before: { isActive: before.isActive },
      after: { isActive: user.isActive },
    });
    return user;
  });
}

export async function resetPassword(actor: CurrentUser, input: { id: string; password: string }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.id }, select: { id: true } });
    if (!target) throw new BusinessError("ไม่พบผู้ใช้");
    await tx.user.update({ where: { id: input.id }, data: { passwordHash } });
    await audit(tx, { userId: actor.id, action: "USER_PASSWORD_RESET", entity: "User", entityId: input.id });
  });
}
