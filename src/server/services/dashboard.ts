import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import { loadInsights } from "./bi";
import { dayTotals, daysBetween, lastNDays, salesReport, topProducts, type DateRange } from "./reports";
import { listInventory } from "./inventory";
import { unreadNotificationCount } from "./notifications";

function yesterdayOf(day: string) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const MAX_RANGE_DAYS = 366;
const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;

export type DashboardRangeInput = { range?: string; from?: string; to?: string };

/**
 * ช่วงวันของกราฟ: ใช้ from/to ที่ผู้ใช้เลือกถ้าถูกต้องทั้งหมด (วันจริง, from ≤ to ≤ วันนี้, ไม่เกิน 366 วัน)
 * มิฉะนั้นกลับไปใช้ค่าสำเร็จรูป 7/30 วัน (range=30 → 30 วัน ที่เหลือ 7 วัน); invalid = true เมื่อผู้ใช้ส่งช่วงมาแต่ใช้ไม่ได้
 */
export function resolveDashboardRange(input: DashboardRangeInput, today: string): { range: DateRange; preset: 7 | 30 | null; invalid: boolean } {
  const preset: 7 | 30 = input.range === "30" ? 30 : 7;
  const fallback = { range: lastNDays(preset, new Date(`${today}T12:00:00+07:00`)), preset, invalid: false };
  if (input.from === undefined && input.to === undefined) return fallback;
  const { from, to } = input;
  if (!from || !to || !isRealDate(from) || !isRealDate(to) || from > to || to > today || daysBetween({ from, to }).length > MAX_RANGE_DAYS) return { ...fallback, invalid: true };
  return { range: { from, to }, preset: null, invalid: false };
}

export async function loadDashboard(range: DateRange) {
  const today = todayBangkokKey();
  const rangeDays = daysBetween(range).length;
  const [todayRow, yRow, series, top, products, counts, near, expired, unread, bi] = await Promise.all([
    dayTotals(today),
    dayTotals(yesterdayOf(today)),
    salesReport(range),
    topProducts(lastNDays(7), 5),
    db.product.count({ where: { isActive: true } }),
    db.$queryRaw<{ low: bigint; out: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE "stockQty" > 0 AND "stockQty" <= "minStock") AS low, COUNT(*) FILTER (WHERE "stockQty" <= 0) AS out
      FROM "Product" WHERE "isActive"`,
    listInventory({ filter: "near_expiry" }),
    listInventory({ filter: "expired" }),
    unreadNotificationCount(),
    loadInsights(),
  ]);
  const lowList = (await listInventory({ filter: "low" })).rows.slice(0, 5);
  return {
    today, rangeDays,
    todayNet: todayRow.net, todayBills: todayRow.bills, todayGross: todayRow.gross, todayRefunds: todayRow.refunds, yesterdayNet: yRow.net,
    products, lowStock: Number(counts[0]?.low ?? 0), outOfStock: Number(counts[0]?.out ?? 0),
    nearExpiryProducts: near.rows.length, expiredProducts: expired.rows.length, unread,
    chart: series.rows.map((r) => ({ day: r.day, net: Number(r.net), bills: r.bills })),
    rangeTotals: series.totals,
    top, lowList: lowList.map((r) => ({ id: r.id, name: r.name, stock: r.stockQty, min: r.minStock, unit: r.unit })),
    insights: bi.insights,
  };
}
