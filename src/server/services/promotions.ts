import type { Prisma, Promotion } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { D } from "@/lib/money";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import type { PromoRule } from "./pricing";

type Client = Prisma.TransactionClient | typeof db;

export const toRule = (p: Promotion): PromoRule => ({
  id: p.id, name: p.name, scope: p.scope, discountType: p.discountType, value: p.value, productId: p.productId, categoryId: p.categoryId,
  minPurchase: p.minPurchase, startsAt: p.startsAt, endsAt: p.endsAt, isActive: p.isActive,
});

type Loader = (client: Client, now: Date) => Promise<PromoRule[]>;
let loaderOverride: Loader | null = null;

/** ใช้ได้เฉพาะ NODE_ENV=test — ให้เทสต์ที่ตรวจยอดเงินแน่นอนไม่ปนกับโปรโมชั่นจริงใน DB */
export function _setPromotionLoaderForTests(l: Loader | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("_setPromotionLoaderForTests ใช้ได้เฉพาะตอนทดสอบ");
  loaderOverride = l;
}

/** โปรโมชั่นที่ใช้งานได้ ณ เวลานั้น (อ่านจาก DB เสมอ — ห้ามเชื่อ client) */
export async function loadActivePromotions(client: Client, now: Date): Promise<PromoRule[]> {
  if (loaderOverride) return loaderOverride(client, now);
  const rows = await client.promotion.findMany({ where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } });
  return rows.map(toRule);
}

export type PromoStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "DISABLED";
export const promoStatus = (p: { isActive: boolean; startsAt: Date; endsAt: Date }, now = new Date()): PromoStatus =>
  !p.isActive ? "DISABLED" : p.startsAt > now ? "SCHEDULED" : p.endsAt <= now ? "EXPIRED" : "ACTIVE";

export async function listPromotions() {
  const [rows, products, categories] = await Promise.all([
    db.promotion.findMany({ orderBy: [{ isActive: "desc" }, { startsAt: "desc" }], include: { product: { select: { name: true, sku: true } }, category: { select: { name: true } } } }),
    db.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  return {
    products, categories,
    items: rows.map((p) => ({
      id: p.id, name: p.name, scope: p.scope, discountType: p.discountType, value: p.value.toFixed(2),
      productId: p.productId, categoryId: p.categoryId, targetLabel: p.product ? `${p.product.name} (${p.product.sku})` : p.category?.name ?? "ทั้งบิล",
      minPurchase: p.minPurchase?.toFixed(2) ?? null, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), isActive: p.isActive, status: promoStatus(p, now),
    })),
  };
}

type Input = {
  name: string; scope: "PRODUCT" | "CATEGORY" | "BILL"; discountType: "PERCENT" | "FIXED"; value: string;
  productId: string | null; categoryId: string | null; minPurchase: string | null; startsAt: Date; endsAt: Date;
};

async function assertTargets(tx: Prisma.TransactionClient, i: Input) {
  if (i.scope === "PRODUCT" && !(await tx.product.findUnique({ where: { id: i.productId! }, select: { id: true } }))) throw new BusinessError("ไม่พบสินค้าที่เลือก");
  if (i.scope === "CATEGORY" && !(await tx.category.findUnique({ where: { id: i.categoryId! }, select: { id: true } }))) throw new BusinessError("ไม่พบหมวดหมู่ที่เลือก");
}

const data = (i: Input) => ({
  name: i.name, scope: i.scope, discountType: i.discountType, value: D(i.value),
  productId: i.scope === "PRODUCT" ? i.productId : null, categoryId: i.scope === "CATEGORY" ? i.categoryId : null,
  minPurchase: i.scope === "BILL" && i.minPurchase ? D(i.minPurchase) : null, startsAt: i.startsAt, endsAt: i.endsAt,
});

const snap = (p: Promotion) => ({ name: p.name, scope: p.scope, discountType: p.discountType, value: p.value.toFixed(2), productId: p.productId, categoryId: p.categoryId, minPurchase: p.minPurchase?.toFixed(2) ?? null, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), isActive: p.isActive });

export async function createPromotion(actor: CurrentUser, input: Input) {
  return db.$transaction(async (tx) => {
    await assertTargets(tx, input);
    const p = await tx.promotion.create({ data: data(input) });
    await audit(tx, { userId: actor.id, action: "PROMOTION_CREATE", entity: "Promotion", entityId: p.id, after: snap(p) });
    return { id: p.id };
  });
}

export async function updatePromotion(actor: CurrentUser, input: Input & { id: string }) {
  return db.$transaction(async (tx) => {
    const before = await tx.promotion.findUnique({ where: { id: input.id } });
    if (!before) throw new BusinessError("ไม่พบโปรโมชั่น");
    await assertTargets(tx, input);
    const p = await tx.promotion.update({ where: { id: input.id }, data: data(input) });
    await audit(tx, { userId: actor.id, action: "PROMOTION_UPDATE", entity: "Promotion", entityId: p.id, before: snap(before), after: snap(p) });
    return { id: p.id };
  });
}

export async function setPromotionActive(actor: CurrentUser, input: { id: string; isActive: boolean }) {
  await db.$transaction(async (tx) => {
    const before = await tx.promotion.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!before) throw new BusinessError("ไม่พบโปรโมชั่น");
    if (before.isActive === input.isActive) return;
    await tx.promotion.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit(tx, { userId: actor.id, action: input.isActive ? "PROMOTION_ENABLE" : "PROMOTION_DISABLE", entity: "Promotion", entityId: input.id, before: { isActive: before.isActive }, after: { isActive: input.isActive } });
  });
}
