import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import { getNearExpiryDays } from "./settings";

const keyOf = (d: Date) => d.toISOString().slice(0, 10);

export type BatchState = "OK" | "NEAR_EXPIRY" | "EXPIRED";

/** สถานะล็อตตามวันหมดอายุ (เทียบวันที่ตามเวลาไทย): หมดอายุ = expiryDate < วันนี้ */
export function batchState(expiryDate: Date | null, todayKey: string, nearDays: number): BatchState {
  if (!expiryDate) return "OK";
  const exp = keyOf(expiryDate);
  if (exp < todayKey) return "EXPIRED";
  const limit = new Date(`${todayKey}T00:00:00.000Z`);
  limit.setUTCDate(limit.getUTCDate() + nearDays);
  return exp <= keyOf(limit) ? "NEAR_EXPIRY" : "OK";
}

export type StockStatus = "OUT" | "LOW" | "OK";
export const stockStatus = (qty: number, min: number): StockStatus => (qty <= 0 ? "OUT" : qty <= min ? "LOW" : "OK");

export type InventoryFilter = "all" | "low" | "out" | "near_expiry" | "expired";

export type InventoryRow = {
  id: string; sku: string; name: string; categoryName: string; unit: string; isActive: boolean;
  stockQty: number; sellableQty: number; minStock: number; status: StockStatus;
  expiredQty: number; nearExpiryQty: number; nextExpiry: string | null;
};

export async function listInventory(opts: { q?: string; filter?: InventoryFilter; includeInactive?: boolean }) {
  const q = opts.q?.trim().slice(0, 100);
  const today = todayBangkokKey();
  const nearDays = await getNearExpiryDays();

  const where: Prisma.ProductWhereInput = {
    ...(opts.includeInactive ? {} : { isActive: true }),
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] }),
  };
  const [products, batches] = await Promise.all([
    db.product.findMany({ where, include: { category: { select: { name: true } } }, orderBy: [{ name: "asc" }] }),
    db.productBatch.findMany({ where: { remainingQty: { gt: 0 }, product: where }, select: { productId: true, remainingQty: true, expiryDate: true } }),
  ]);

  const agg = new Map<string, { sellable: number; expired: number; near: number; next: string | null }>();
  for (const b of batches) {
    const a = agg.get(b.productId) ?? { sellable: 0, expired: 0, near: 0, next: null };
    const st = batchState(b.expiryDate, today, nearDays);
    if (st === "EXPIRED") a.expired += b.remainingQty;
    else {
      a.sellable += b.remainingQty;
      if (st === "NEAR_EXPIRY") a.near += b.remainingQty;
    }
    if (b.expiryDate) {
      const k = keyOf(b.expiryDate);
      if (!a.next || k < a.next) a.next = k;
    }
    agg.set(b.productId, a);
  }

  let rows: InventoryRow[] = products.map((p) => {
    const a = agg.get(p.id) ?? { sellable: 0, expired: 0, near: 0, next: null };
    return {
      id: p.id, sku: p.sku, name: p.name, categoryName: p.category.name, unit: p.unit, isActive: p.isActive,
      stockQty: p.stockQty, sellableQty: a.sellable, minStock: p.minStock, status: stockStatus(p.stockQty, p.minStock),
      expiredQty: a.expired, nearExpiryQty: a.near, nextExpiry: a.next,
    };
  });
  const f = opts.filter ?? "all";
  if (f === "low") rows = rows.filter((r) => r.status === "LOW");
  if (f === "out") rows = rows.filter((r) => r.status === "OUT");
  if (f === "near_expiry") rows = rows.filter((r) => r.nearExpiryQty > 0);
  if (f === "expired") rows = rows.filter((r) => r.expiredQty > 0);
  return { rows, nearDays };
}

export async function getProductStock(productId: string, includeCost: boolean) {
  const product = await db.product.findUnique({ where: { id: productId }, include: { category: { select: { name: true } } } });
  if (!product) return null;
  const today = todayBangkokKey();
  const nearDays = await getNearExpiryDays();
  const batches = await db.productBatch.findMany({
    where: { productId },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
  });
  return {
    product: { id: product.id, sku: product.sku, name: product.name, categoryName: product.category.name, unit: product.unit, stockQty: product.stockQty, minStock: product.minStock, isActive: product.isActive, costPrice: includeCost ? product.costPrice.toFixed(2) : null },
    nearDays,
    batches: batches.map((b) => ({
      id: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate ? keyOf(b.expiryDate) : null, receivedAt: b.receivedAt.toISOString(),
      costPrice: includeCost ? b.costPrice.toFixed(2) : null, initialQty: b.initialQty, remainingQty: b.remainingQty, state: batchState(b.expiryDate, today, nearDays),
    })),
  };
}

export const MOVEMENT_PAGE_SIZE = 30;

export async function listMovements(opts: { productId?: string; type?: string; page?: number }) {
  const where: Prisma.StockMovementWhereInput = {
    ...(opts.productId && { productId: opts.productId }),
    ...(opts.type && { type: opts.type as Prisma.StockMovementWhereInput["type"] }),
  };
  const page = Math.max(1, opts.page ?? 1);
  const [rows, total] = await Promise.all([
    db.stockMovement.findMany({
      where,
      include: { product: { select: { sku: true, name: true, unit: true } }, batch: { select: { batchNo: true } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * MOVEMENT_PAGE_SIZE,
      take: MOVEMENT_PAGE_SIZE,
    }),
    db.stockMovement.count({ where }),
  ]);
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / MOVEMENT_PAGE_SIZE)),
    rows: rows.map((m) => ({
      id: m.id, createdAt: m.createdAt.toISOString(), type: m.type, quantityChange: m.quantityChange, balanceAfter: m.balanceAfter,
      note: m.note, sku: m.product.sku, productName: m.product.name, unit: m.product.unit, batchNo: m.batch?.batchNo ?? null, by: m.createdBy.name,
    })),
  };
}
