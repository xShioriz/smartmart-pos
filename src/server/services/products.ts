import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { D } from "@/lib/money";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { uniqueViolationFields } from "@/server/prisma-errors";
import { receiveBatch } from "./stock";

export const PRODUCT_PAGE_SIZE = 20;

export type ProductFilters = { q?: string; categoryId?: string; status?: "all" | "active" | "inactive"; page?: number };

export async function listProducts(f: ProductFilters) {
  const q = f.q?.trim().slice(0, 100);
  const where: Prisma.ProductWhereInput = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q } },
      ],
    }),
    ...(f.categoryId && { categoryId: f.categoryId }),
    ...(f.status === "active" && { isActive: true }),
    ...(f.status === "inactive" && { isActive: false }),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      include: { category: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { sku: "asc" }],
      skip: (page - 1) * PRODUCT_PAGE_SIZE,
      take: PRODUCT_PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);
  // Decimal → string ก่อนส่งให้ Client Component
  const items = rows.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    costPrice: p.costPrice.toFixed(2),
    price: p.price.toFixed(2),
    unit: p.unit,
    stockQty: p.stockQty,
    minStock: p.minStock,
    isActive: p.isActive,
  }));
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)) };
}

export type ProductRow = Awaited<ReturnType<typeof listProducts>>["items"][number];

function mapUnique(e: unknown): never {
  const fields = uniqueViolationFields(e);
  if (fields) {
    if (fields.includes("sku")) throw new BusinessError("SKU นี้ถูกใช้แล้ว");
    if (fields.includes("barcode")) throw new BusinessError("บาร์โค้ดนี้ถูกใช้แล้ว");
    throw new BusinessError("ข้อมูลซ้ำกับสินค้าที่มีอยู่");
  }
  throw e;
}

type Core = { sku: string; barcode: string | null; name: string; categoryId: string; costPrice: string; price: string; unit: string; minStock: number };

async function assertCategory(tx: Prisma.TransactionClient, id: string) {
  if (!(await tx.category.findUnique({ where: { id }, select: { id: true } }))) throw new BusinessError("ไม่พบหมวดหมู่ที่เลือก");
}

export async function createProduct(actor: CurrentUser, input: Core & { initialQty: number; initialExpiry: string | null }) {
  try {
    return await db.$transaction(async (tx) => {
      await assertCategory(tx, input.categoryId);
      const product = await tx.product.create({
        data: {
          sku: input.sku,
          barcode: input.barcode,
          name: input.name,
          categoryId: input.categoryId,
          costPrice: D(input.costPrice),
          price: D(input.price),
          unit: input.unit,
          minStock: input.minStock,
        },
      });
      if (input.initialQty > 0) {
        await receiveBatch(tx, actor.id, {
          productId: product.id,
          qty: input.initialQty,
          costPrice: D(input.costPrice),
          expiryDate: input.initialExpiry,
          type: "INITIAL",
          note: "สต็อกเริ่มต้น (สร้างสินค้า)",
        });
      }
      await audit(tx, {
        userId: actor.id,
        action: "PRODUCT_CREATE",
        entity: "Product",
        entityId: product.id,
        after: { sku: input.sku, name: input.name, costPrice: input.costPrice, price: input.price, initialQty: input.initialQty },
      });
      return { id: product.id };
    });
  } catch (e) {
    mapUnique(e);
  }
}

export async function updateProduct(actor: CurrentUser, input: Core & { id: string }) {
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id: input.id } });
      if (!before) throw new BusinessError("ไม่พบสินค้า");
      await assertCategory(tx, input.categoryId);
      const after = await tx.product.update({
        where: { id: input.id },
        data: {
          sku: input.sku,
          barcode: input.barcode,
          name: input.name,
          categoryId: input.categoryId,
          costPrice: D(input.costPrice),
          price: D(input.price),
          unit: input.unit,
          minStock: input.minStock,
        },
      });
      const snap = (p: typeof before) => ({
        sku: p.sku, barcode: p.barcode, name: p.name, categoryId: p.categoryId,
        costPrice: p.costPrice.toFixed(2), price: p.price.toFixed(2), unit: p.unit, minStock: p.minStock,
      });
      const b = snap(before), a = snap(after);
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        const priceChanged = b.price !== a.price || b.costPrice !== a.costPrice;
        await audit(tx, {
          userId: actor.id,
          action: priceChanged ? "PRODUCT_PRICE_CHANGE" : "PRODUCT_UPDATE",
          entity: "Product",
          entityId: after.id,
          before: b,
          after: a,
        });
      }
      return { id: after.id };
    });
  } catch (e) {
    mapUnique(e);
  }
}

export async function setProductActive(actor: CurrentUser, input: { id: string; isActive: boolean }) {
  await db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!before) throw new BusinessError("ไม่พบสินค้า");
    if (before.isActive === input.isActive) return;
    await tx.product.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit(tx, {
      userId: actor.id,
      action: input.isActive ? "PRODUCT_ENABLE" : "PRODUCT_DISABLE",
      entity: "Product",
      entityId: input.id,
      before: { isActive: before.isActive },
      after: { isActive: input.isActive },
    });
  });
}
