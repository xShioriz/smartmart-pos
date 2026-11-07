import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { isForeignKeyViolation, uniqueViolationFields } from "@/server/prisma-errors";

export function listCategories(q?: string) {
  const term = q?.trim().slice(0, 100);
  return db.category.findMany({
    where: term ? { name: { contains: term, mode: "insensitive" } } : undefined,
    select: { id: true, name: true, description: true, _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
}

export function categoryOptions() {
  return db.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function createCategory(actor: CurrentUser, input: { name: string; description: string | null }) {
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.category.create({ data: input });
      await audit(tx, { userId: actor.id, action: "CATEGORY_CREATE", entity: "Category", entityId: c.id, after: input });
      return c;
    });
  } catch (e) {
    if (uniqueViolationFields(e)) throw new BusinessError("ชื่อหมวดหมู่นี้มีอยู่แล้ว");
    throw e;
  }
}

export async function updateCategory(actor: CurrentUser, input: { id: string; name: string; description: string | null }) {
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id: input.id } });
      if (!before) throw new BusinessError("ไม่พบหมวดหมู่");
      const c = await tx.category.update({ where: { id: input.id }, data: { name: input.name, description: input.description } });
      await audit(tx, {
        userId: actor.id,
        action: "CATEGORY_UPDATE",
        entity: "Category",
        entityId: c.id,
        before: { name: before.name, description: before.description },
        after: { name: c.name, description: c.description },
      });
      return c;
    });
  } catch (e) {
    if (uniqueViolationFields(e)) throw new BusinessError("ชื่อหมวดหมู่นี้มีอยู่แล้ว");
    throw e;
  }
}

export async function deleteCategory(actor: CurrentUser, id: string) {
  try {
    await db.$transaction(async (tx) => {
      const c = await tx.category.findUnique({ where: { id }, include: { _count: { select: { products: true, promotions: true } } } });
      if (!c) throw new BusinessError("ไม่พบหมวดหมู่");
      if (c._count.products > 0) throw new BusinessError(`ลบไม่ได้: มีสินค้า ${c._count.products} รายการในหมวดนี้`);
      if (c._count.promotions > 0) throw new BusinessError(`ลบไม่ได้: มีโปรโมชั่น ${c._count.promotions} รายการอ้างอิงหมวดนี้`);
      await tx.category.delete({ where: { id } });
      await audit(tx, { userId: actor.id, action: "CATEGORY_DELETE", entity: "Category", entityId: id, before: { name: c.name } });
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new BusinessError("ลบไม่ได้: มีข้อมูลอื่นอ้างอิงหมวดหมู่นี้");
    throw e;
  }
}
