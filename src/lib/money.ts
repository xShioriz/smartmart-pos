import { Prisma } from "@prisma/client";

export type Money = Prisma.Decimal;

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** ปัดเป็นสตางค์ (2 ตำแหน่ง) แบบ half-up — ใช้ทุกครั้งที่ได้ค่าเงินจากการคูณ/หาร */
export const round2 = (v: Prisma.Decimal.Value) =>
  D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** แปลงบาทเป็นสตางค์ (จำนวนเต็ม) สำหรับส่งให้ Payment Provider */
export const toSatang = (v: Prisma.Decimal.Value) =>
  round2(v).mul(100).toDecimalPlaces(0).toNumber();

export const fromSatang = (satang: number) => round2(D(satang).div(100));

/** แสดงผล เช่น ฿1,234.50 — รับ Decimal/number/string */
export function formatMoney(v: Prisma.Decimal.Value): string {
  const n = round2(v).toNumber();
  return (
    "฿" +
    n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
