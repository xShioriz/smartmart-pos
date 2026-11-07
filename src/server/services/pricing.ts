// คำนวณราคาบิล (pure function — ไม่แตะ DB) ใช้ร่วมกันระหว่าง checkout และ (Day 6) ตัวอย่างราคาในตะกร้า
// Day 5: ยังไม่มีโปรโมชั่น/ส่วนลด (discountAmount = 0) — ช่องส่วนลดเตรียมไว้ให้ Day 6 ต่อยอดโดยไม่เปลี่ยนรูปแบบผลลัพธ์
import type { Prisma } from "@prisma/client";
import { D, round2 } from "@/lib/money";

export type PriceLineInput = { productId: string; unitPrice: Prisma.Decimal.Value; quantity: number };

export type PricedLine = {
  productId: string;
  unitPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal; // unitPrice * quantity
  discountAmount: Prisma.Decimal;
  netTotal: Prisma.Decimal; // lineTotal - discountAmount
};

export type PricedCart = { lines: PricedLine[]; subtotal: Prisma.Decimal; discountTotal: Prisma.Decimal; total: Prisma.Decimal };

export function calculateCart(lines: PriceLineInput[]): PricedCart {
  const priced: PricedLine[] = lines.map((l) => {
    const unitPrice = round2(l.unitPrice);
    const lineTotal = round2(unitPrice.mul(l.quantity));
    const discountAmount = D(0);
    return { productId: l.productId, unitPrice, quantity: l.quantity, lineTotal, discountAmount, netTotal: lineTotal.sub(discountAmount) };
  });
  const subtotal = priced.reduce((s, l) => s.add(l.lineTotal), D(0));
  const discountTotal = priced.reduce((s, l) => s.add(l.discountAmount), D(0));
  return { lines: priced, subtotal, discountTotal, total: subtotal.sub(discountTotal) };
}
