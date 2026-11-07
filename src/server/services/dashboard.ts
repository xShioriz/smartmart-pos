import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import { loadInsights } from "./bi";
import { dayTotals, lastNDays, salesReport, topProducts } from "./reports";
import { listInventory } from "./inventory";
import { unreadNotificationCount } from "./notifications";

function yesterdayOf(day: string) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function loadDashboard(rangeDays: 7 | 30) {
  const today = todayBangkokKey();
  const range = lastNDays(rangeDays);
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
