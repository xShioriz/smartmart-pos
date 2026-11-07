// คำนวณราคาบิล + โปรโมชั่น (pure function — ไม่แตะ DB) ใช้ร่วมกันระหว่างตัวอย่างราคาในตะกร้า, checkout เงินสด และ QR
//
// กติกา (ตรึงไว้ตามแผน v2/v2.1):
//  1) โปรโมชั่นรายการ (PRODUCT/CATEGORY): แต่ละบรรทัดใช้ได้ "อันเดียว" = อันที่ลดได้มากที่สุด (ไม่ซ้อนกัน; เท่ากันเลือก id น้อยกว่าเพื่อให้ผลคงที่)
//     - PERCENT: ลด % ของยอดบรรทัด; FIXED: ลดบาทต่อหน่วย (ไม่เกินราคาต่อหน่วย)
//  2) โปรโมชั่นทั้งบิล (BILL): ใช้ได้ "อันเดียว" คิดจากยอดหลังลดรายการ; ต้องถึง minPurchase (ถ้ามี)
//     - PERCENT: ลด % ของยอดหลังลดรายการ; FIXED: ลดบาท (ไม่เกินยอดนั้น)
//  3) ส่วนลดทั้งบิลกระจายลงแต่ละบรรทัดตามสัดส่วนยอดหลังลดรายการ ในหน่วยสตางค์ (largest remainder)
//     ผลรวมของส่วนที่กระจาย = ส่วนลดทั้งบิลเป๊ะ และไม่เกินยอดของบรรทัดนั้น → SaleItem.netTotal ใช้เป็นฐานคืนเงินได้ตรง
//  4) ปัดเศษทุกจุดด้วย round2 (half-up) — Σ netTotal ของทุกบรรทัด = total เสมอ
import type { Prisma } from "@prisma/client";
import { D, round2 } from "@/lib/money";

export type PromoRule = {
  id: string;
  name: string;
  scope: "PRODUCT" | "CATEGORY" | "BILL";
  discountType: "PERCENT" | "FIXED";
  value: Prisma.Decimal.Value;
  productId: string | null;
  categoryId: string | null;
  minPurchase: Prisma.Decimal.Value | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
};

export type PriceLineInput = { productId: string; categoryId: string; unitPrice: Prisma.Decimal.Value; quantity: number };

export type PricedLine = {
  productId: string;
  unitPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal; // unitPrice * quantity
  itemDiscount: Prisma.Decimal; // ส่วนลดโปรรายการ
  billShare: Prisma.Decimal; // ส่วนลดทั้งบิลที่กระจายมาบรรทัดนี้
  discountAmount: Prisma.Decimal; // itemDiscount + billShare
  netTotal: Prisma.Decimal; // lineTotal - discountAmount (ฐานคิดเงินคืน)
  promotion: { id: string; name: string } | null; // โปรรายการที่ใช้
};

export type PricedCart = {
  lines: PricedLine[]; // เรียงตาม productId
  subtotal: Prisma.Decimal;
  itemDiscountTotal: Prisma.Decimal;
  billDiscount: Prisma.Decimal;
  billPromotion: { id: string; name: string } | null;
  discountTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

export const isPromoActive = (p: PromoRule, now: Date) => p.isActive && p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();

function itemDiscountFor(p: PromoRule, unitPrice: Prisma.Decimal, quantity: number, lineTotal: Prisma.Decimal): Prisma.Decimal {
  const raw = p.discountType === "PERCENT" ? lineTotal.mul(D(p.value)).div(100) : D(p.value).lessThan(unitPrice) ? D(p.value).mul(quantity) : lineTotal;
  const d = round2(raw);
  return d.greaterThan(lineTotal) ? lineTotal : d.isNegative() ? D(0) : d;
}

function billDiscountFor(p: PromoRule, base: Prisma.Decimal): Prisma.Decimal {
  const raw = p.discountType === "PERCENT" ? base.mul(D(p.value)).div(100) : D(p.value);
  const d = round2(raw);
  return d.greaterThan(base) ? base : d.isNegative() ? D(0) : d;
}

/** เลือกอันที่ลดมากสุด; เท่ากันเลือก id น้อยกว่า */
function best<T extends { id: string }>(items: { promo: T; discount: Prisma.Decimal }[]) {
  let pick: { promo: T; discount: Prisma.Decimal } | null = null;
  for (const it of items) {
    if (!it.discount.greaterThan(0)) continue;
    if (!pick || it.discount.greaterThan(pick.discount) || (it.discount.equals(pick.discount) && it.promo.id < pick.promo.id)) pick = it;
  }
  return pick;
}

/** กระจายส่วนลด (สตางค์) ตามน้ำหนัก ด้วย largest remainder — ผลรวมเท่ากับ total เป๊ะ และแต่ละส่วนไม่เกินน้ำหนักของตัวเอง */
export function allocateSatang(totalSatang: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const sumW = weights.reduce((s, w) => s.add(w), D(0));
  if (totalSatang.isZero() || sumW.isZero()) return weights.map(() => D(0));
  const parts = weights.map((w, i) => {
    const exact = totalSatang.mul(w);
    const floor = exact.div(sumW).toDecimalPlaces(0, 1 /* ROUND_DOWN */);
    return { i, w, alloc: floor, frac: exact.sub(floor.mul(sumW)) };
  });
  let left = totalSatang.sub(parts.reduce((s, p) => s.add(p.alloc), D(0)));
  const order = [...parts].sort((a, b) => (b.frac.comparedTo(a.frac) || a.i - b.i));
  while (left.greaterThan(0)) {
    let progressed = false;
    for (const p of order) {
      if (left.isZero()) break;
      if (p.alloc.lessThan(p.w)) { p.alloc = p.alloc.add(1); left = left.sub(1); progressed = true; }
    }
    if (!progressed) break; // ไม่ควรเกิด (total ≤ Σ weights เสมอ)
  }
  return parts.sort((a, b) => a.i - b.i).map((p) => p.alloc);
}

export function calculateCart(lines: PriceLineInput[], promos: PromoRule[] = [], now: Date = new Date()): PricedCart {
  const active = promos.filter((p) => isPromoActive(p, now));
  const sorted = [...lines].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

  const priced = sorted.map((l) => {
    const unitPrice = round2(l.unitPrice);
    const lineTotal = round2(unitPrice.mul(l.quantity));
    const candidates = active
      .filter((p) => (p.scope === "PRODUCT" && p.productId === l.productId) || (p.scope === "CATEGORY" && p.categoryId === l.categoryId))
      .map((promo) => ({ promo, discount: itemDiscountFor(promo, unitPrice, l.quantity, lineTotal) }));
    const pick = best(candidates);
    return {
      productId: l.productId, unitPrice, quantity: l.quantity, lineTotal,
      itemDiscount: pick?.discount ?? D(0), promotion: pick ? { id: pick.promo.id, name: pick.promo.name } : null,
    };
  });

  const subtotal = priced.reduce((s, l) => s.add(l.lineTotal), D(0));
  const itemDiscountTotal = priced.reduce((s, l) => s.add(l.itemDiscount), D(0));
  const base = subtotal.sub(itemDiscountTotal);

  const billPick = best(
    active
      .filter((p) => p.scope === "BILL" && (p.minPurchase === null || base.greaterThanOrEqualTo(D(p.minPurchase))))
      .map((promo) => ({ promo, discount: billDiscountFor(promo, base) })),
  );
  const billDiscount = billPick?.discount ?? D(0);

  const shares = allocateSatang(
    billDiscount.mul(100),
    priced.map((l) => l.lineTotal.sub(l.itemDiscount).mul(100)),
  ).map((s) => s.div(100));

  const out: PricedLine[] = priced.map((l, i) => {
    const billShare = shares[i];
    const discountAmount = l.itemDiscount.add(billShare);
    return { ...l, billShare, discountAmount, netTotal: l.lineTotal.sub(discountAmount) };
  });

  const discountTotal = itemDiscountTotal.add(billDiscount);
  return {
    lines: out, subtotal, itemDiscountTotal, billDiscount,
    billPromotion: billPick ? { id: billPick.promo.id, name: billPick.promo.name } : null,
    discountTotal, total: subtotal.sub(discountTotal),
  };
}
