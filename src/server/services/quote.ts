// ตัวอย่างราคาสำหรับหน้า POS: คำนวณด้วยฟังก์ชันและโปรโมชั่นชุดเดียวกับ checkout (อ่านจาก DB) — ไม่แตะสต็อก/ไม่สร้างข้อมูลใด ๆ
import { db } from "@/server/db";
import { BusinessError } from "@/lib/result";
import { mergeItems, priceMerged } from "./checkout";
import { assertMemberUsable, pointsFor } from "./members";

export type Quote = {
  lines: { productId: string; quantity: number; unitPrice: string; lineTotal: string; discount: string; net: string; promotionName: string | null }[];
  subtotal: string;
  itemDiscount: string;
  billDiscount: string;
  billPromotionName: string | null;
  discountTotal: string;
  total: string;
  points: number; // แต้มที่คาดว่าจะได้ (0 ถ้าไม่มีสมาชิก)
};

export async function quoteCart(input: { items: { productId: string; quantity: number }[]; memberId?: string | null }): Promise<Quote> {
  if (input.items.length === 0) throw new BusinessError("ตะกร้าว่างเปล่า");
  const merged = mergeItems(input.items);
  if (input.memberId) await assertMemberUsable(db, input.memberId);
  const { byId, cart } = await priceMerged(db, merged);
  void byId;
  return {
    lines: cart.lines.map((l) => ({
      productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2),
      discount: l.discountAmount.toFixed(2), net: l.netTotal.toFixed(2), promotionName: l.promotion?.name ?? null,
    })),
    subtotal: cart.subtotal.toFixed(2), itemDiscount: cart.itemDiscountTotal.toFixed(2), billDiscount: cart.billDiscount.toFixed(2),
    billPromotionName: cart.billPromotion?.name ?? null, discountTotal: cart.discountTotal.toFixed(2), total: cart.total.toFixed(2),
    points: input.memberId ? await pointsFor(cart.total) : 0,
  };
}
