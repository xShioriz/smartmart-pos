// รายงานยอดขาย (ADMIN) — ตัวเลขทั้งหมดมาจาก SQL บนข้อมูลจริง "วัน" = วันตามเวลาไทย (Asia/Bangkok)
// นิยาม:
//  - บิลที่นับ = สถานะ COMPLETED / PARTIALLY_RETURNED / FULLY_RETURNED (บิลรอจ่าย/ยกเลิก/รอตรวจสอบไม่นับ)
//  - ยอดขาย (gross) = Σ Sale.total ตามวันที่ขาย; เงินคืน = Σ SaleReturn.refundTotal ตามวันที่คืน
//  - ยอดขายสุทธิ = ยอดขาย − เงินคืน; ค่าเฉลี่ยต่อบิล = ยอดขาย ÷ จำนวนบิล (ก่อนหักคืน)
//  - กำไรขั้นต้น = Σ(netTotal − unitCost×จำนวน) ของรายการที่ขาย − Σ(เงินคืน − ต้นทุนของที่คืนเข้าสต็อก)
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { bangkokDayRange, toBangkokDateKey } from "@/lib/date";
import { D, round2 } from "@/lib/money";

const COUNTED = Prisma.sql`s.status IN ('COMPLETED','PARTIALLY_RETURNED','FULLY_RETURNED')`;
// คอลัมน์ DateTime ของ Prisma คือ timestamp ไม่มี timezone ที่เก็บเป็น UTC → ต้องบอกก่อนว่าเป็น UTC แล้วค่อยแปลงเป็นเวลาไทย
// (เขียน col AT TIME ZONE 'Asia/Bangkok' ตรง ๆ จะตีความค่าเป็นเวลาไทยแล้วแปลงกลับ ทำให้วันเลื่อนไป 7 ชั่วโมง)
const DAY = (col: string) => Prisma.raw(`(((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date)::text`);

export type DateRange = { from: string; to: string }; // yyyy-MM-dd (เวลาไทย) รวมทั้งสองวัน

export function rangeBounds(r: DateRange) {
  return { start: bangkokDayRange(r.from).start, end: bangkokDayRange(r.to).end };
}

/** รายการวันที่ (yyyy-MM-dd) ตั้งแต่ from ถึง to */
export function daysBetween(r: DateRange): string[] {
  const out: string[] = [];
  const cur = new Date(`${r.from}T00:00:00.000Z`);
  const end = new Date(`${r.to}T00:00:00.000Z`);
  while (cur <= end && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function lastNDays(n: number, now = new Date()): DateRange {
  const to = toBangkokDateKey(now);
  const d = new Date(`${to}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - (n - 1));
  return { from: d.toISOString().slice(0, 10), to };
}

type Num = Prisma.Decimal | number | string | bigint | null;
const dec = (v: Num) => D(v === null ? 0 : typeof v === "bigint" ? Number(v) : v);

export type DailyRow = { day: string; bills: number; gross: string; refunds: string; net: string; profit: string; cash: string; qr: string };

export async function salesReport(r: DateRange) {
  const { start, end } = rangeBounds(r);
  const [sales, refunds, saleProfit, retProfit] = await Promise.all([
    db.$queryRaw<{ day: string; bills: bigint; gross: Num; cash: Num; qr: Num }[]>`
      SELECT ${DAY('s."createdAt"')} AS day, COUNT(*) AS bills, COALESCE(SUM(s.total),0) AS gross,
             COALESCE(SUM(s.total) FILTER (WHERE s."paymentMethod"='CASH'),0) AS cash,
             COALESCE(SUM(s.total) FILTER (WHERE s."paymentMethod"='PROMPTPAY'),0) AS qr
      FROM "Sale" s WHERE ${COUNTED} AND s."createdAt" >= ${start} AND s."createdAt" < ${end} GROUP BY 1`,
    db.$queryRaw<{ day: string; refunds: Num }[]>`
      SELECT ${DAY('r."createdAt"')} AS day, COALESCE(SUM(r."refundTotal"),0) AS refunds
      FROM "SaleReturn" r WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end} GROUP BY 1`,
    db.$queryRaw<{ day: string; profit: Num }[]>`
      SELECT ${DAY('s."createdAt"')} AS day, COALESCE(SUM(i."netTotal" - i."unitCost" * i.quantity),0) AS profit
      FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
      WHERE ${COUNTED} AND s."createdAt" >= ${start} AND s."createdAt" < ${end} GROUP BY 1`,
    db.$queryRaw<{ day: string; effect: Num }[]>`
      SELECT ${DAY('r."createdAt"')} AS day,
             COALESCE(SUM(ri."refundAmount" - CASE WHEN ri.restock THEN si."unitCost" * ri.quantity ELSE 0 END),0) AS effect
      FROM "SaleReturnItem" ri JOIN "SaleReturn" r ON r.id = ri."returnId" JOIN "SaleItem" si ON si.id = ri."saleItemId"
      WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end} GROUP BY 1`,
  ]);

  const by = <T extends { day: string }>(rows: T[]) => new Map(rows.map((x) => [x.day, x]));
  const S = by(sales), R = by(refunds), P = by(saleProfit), E = by(retProfit);
  const rows: DailyRow[] = daysBetween(r).map((day) => {
    const gross = dec(S.get(day)?.gross ?? 0), ref = dec(R.get(day)?.refunds ?? 0);
    const profit = dec(P.get(day)?.profit ?? 0).sub(dec(E.get(day)?.effect ?? 0));
    return {
      day, bills: Number(S.get(day)?.bills ?? 0), gross: gross.toFixed(2), refunds: ref.toFixed(2), net: gross.sub(ref).toFixed(2), profit: profit.toFixed(2),
      cash: dec(S.get(day)?.cash ?? 0).toFixed(2), qr: dec(S.get(day)?.qr ?? 0).toFixed(2),
    };
  });

  const sum = (f: (x: DailyRow) => string) => rows.reduce((a, x) => a.add(f(x)), D(0));
  const bills = rows.reduce((a, x) => a + x.bills, 0);
  const gross = sum((x) => x.gross);
  const totals = {
    bills, gross: gross.toFixed(2), refunds: sum((x) => x.refunds).toFixed(2), net: sum((x) => x.net).toFixed(2), profit: sum((x) => x.profit).toFixed(2),
    cash: sum((x) => x.cash).toFixed(2), qr: sum((x) => x.qr).toFixed(2), avgBill: bills > 0 ? round2(gross.div(bills)).toFixed(2) : "0.00",
  };
  return { rows, totals };
}

export type TopProduct = { productId: string; sku: string; name: string; units: number; revenue: string };

/** สินค้าขายดี: จำนวนสุทธิ (หักที่คืน) และรายได้สุทธิตามสัดส่วนที่ไม่ถูกคืน */
export async function topProducts(r: DateRange, limit = 10): Promise<TopProduct[]> {
  const { start, end } = rangeBounds(r);
  const rows = await db.$queryRaw<{ productId: string; sku: string; name: string; units: bigint; revenue: Num }[]>`
    SELECT i."productId", MAX(i."skuSnapshot") AS sku, MAX(i."nameSnapshot") AS name,
           SUM(i.quantity - i."returnedQty") AS units,
           COALESCE(SUM(i."netTotal" * (i.quantity - i."returnedQty") / i.quantity),0) AS revenue
    FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
    WHERE ${COUNTED} AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
    GROUP BY i."productId" HAVING SUM(i.quantity - i."returnedQty") > 0
    ORDER BY units DESC, revenue DESC, name ASC LIMIT ${limit}`;
  return rows.map((x) => ({ productId: x.productId, sku: x.sku, name: x.name, units: Number(x.units), revenue: dec(x.revenue).toFixed(2) }));
}

/** ยอดขาย/จำนวนบิล/เงินคืนของ "วันเดียว" (ใช้ที่ Dashboard และ BI เปรียบเทียบวัน) */
export async function dayTotals(day: string) {
  const { rows } = await salesReport({ from: day, to: day });
  return rows[0];
}
