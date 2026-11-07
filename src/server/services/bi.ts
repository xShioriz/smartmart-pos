// Smart BI — วิเคราะห์ด้วย "สถิติและกฎที่กำหนด" (rule-based) ทั้งหมด ไม่ใช้ AI/External API และทุกข้อความมีสูตรกำกับ
// ส่วนคำนวณเป็นฟังก์ชันบริสุทธิ์ (ทดสอบได้) ส่วนดึงข้อมูลอยู่ท้ายไฟล์
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { lastNDays, salesReport, topProducts, type DailyRow, type TopProduct } from "./reports";
import { getNearExpiryDays } from "./settings";

export type Insight = {
  id: string;
  severity: "good" | "info" | "warn";
  title: string;
  detail: string;
  formula: string; // สูตร/เกณฑ์ที่ใช้ (แสดงในหน้าเว็บเพื่อความโปร่งใส)
  items?: string[];
};

/* ───────────── ฟังก์ชันสถิติ (pure) ───────────── */

/** ถดถอยเชิงเส้นอย่างง่าย y = a + b·x เมื่อ x = 0..n-1 */
export function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

export type Trend = { direction: "UP" | "DOWN" | "FLAT" | "INSUFFICIENT"; changePct: number; mean: number; daysWithSales: number };

/** แนวโน้ม: เปลี่ยนแปลงทั้งช่วง = slope × (n−1) ÷ ค่าเฉลี่ย; ±5% ถือว่าทรงตัว; มีวันที่ขายได้ < minDays ถือว่าข้อมูลไม่พอ */
export function trendOf(series: number[], opts: { flatPct?: number; minDays?: number } = {}): Trend {
  const flat = opts.flatPct ?? 5;
  const minDays = opts.minDays ?? 3;
  const daysWithSales = series.filter((v) => v > 0).length;
  const mean = series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0;
  if (daysWithSales < minDays || mean <= 0) return { direction: "INSUFFICIENT", changePct: 0, mean, daysWithSales };
  const { slope } = linearRegression(series);
  const changePct = (slope * (series.length - 1) / mean) * 100;
  return { direction: Math.abs(changePct) < flat ? "FLAT" : changePct > 0 ? "UP" : "DOWN", changePct, mean, daysWithSales };
}

/** เปรียบเทียบวัน: คืน null ถ้าไม่มีฐานเปรียบเทียบ (เมื่อวาน = 0) */
export function compareDays(today: number, yesterday: number): number | null {
  return yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : null;
}

/** จำนวนวันที่สต็อกพอขาย = สต็อก ÷ ยอดขายเฉลี่ยต่อวัน; ไม่มียอดขาย = null (ไม่มีวันหมด) */
export function daysOfCover(stock: number, avgDailyUnits: number): number | null {
  return avgDailyUnits > 0 ? stock / avgDailyUnits : null;
}

export type StockCandidate = { name: string; sku: string; stock: number; minStock: number; avgDaily: number };

/** เกณฑ์เตือนสั่งเพิ่ม: เหลือขายได้ < coverDays วัน หรือ สต็อก ≤ ขั้นต่ำ; แนะนำจำนวนให้พอ targetDays วัน */
export function restockSuggestions(list: StockCandidate[], opts: { coverDays?: number; targetDays?: number } = {}) {
  const coverDays = opts.coverDays ?? 7;
  const targetDays = opts.targetDays ?? 14;
  return list
    .map((p) => {
      const cover = daysOfCover(p.stock, p.avgDaily);
      const low = p.stock <= p.minStock;
      const flagged = low || (cover !== null && cover < coverDays);
      const need = Math.max(0, Math.ceil(p.avgDaily * targetDays - p.stock));
      return { ...p, cover, low, flagged, suggest: need };
    })
    .filter((p) => p.flagged)
    .sort((a, b) => (a.cover ?? Infinity) - (b.cover ?? Infinity) || a.stock - b.stock);
}

/* ───────────── ประกอบข้อความ Insight (pure) ───────────── */

export type BiData = {
  today: string;
  series7: DailyRow[]; // 7 วันล่าสุดถึงวันนี้
  top7: TopProduct[];
  stock: StockCandidate[]; // สินค้า active ที่มีสต็อก พร้อมยอดขายเฉลี่ย/วัน 14 วัน
  slow: { name: string; sku: string; stock: number }[]; // ไม่มียอดขาย 14 วัน แต่มีสต็อก
  expiring: { units: number; costValue: string; names: string[] };
  nearDays: number;
};

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function buildInsights(d: BiData): Insight[] {
  const out: Insight[] = [];
  const net = d.series7.map((r) => Number(r.net));

  // 1) เปรียบเทียบวันนี้กับเมื่อวาน
  const today = net[net.length - 1] ?? 0, yest = net[net.length - 2] ?? 0;
  const cmp = compareDays(today, yest);
  out.push(
    cmp === null
      ? { id: "day-compare", severity: "info", title: "เปรียบเทียบยอดขายรายวัน", detail: yest === 0 && today === 0 ? "ยังไม่มียอดขายทั้งวันนี้และเมื่อวาน" : `วันนี้ ${formatMoney(today)} (เมื่อวานไม่มียอดขายจึงเปรียบเทียบเป็น % ไม่ได้)`, formula: "% เปลี่ยนแปลง = (ยอดสุทธิวันนี้ − เมื่อวาน) ÷ เมื่อวาน × 100 (ต้องมียอดเมื่อวาน > 0)" }
      : { id: "day-compare", severity: cmp >= 0 ? "good" : "warn", title: `ยอดขายวันนี้ ${cmp >= 0 ? "สูงกว่า" : "ต่ำกว่า"}เมื่อวาน ${pct(cmp)}`, detail: `วันนี้ ${formatMoney(today)} · เมื่อวาน ${formatMoney(yest)}`, formula: "% เปลี่ยนแปลง = (ยอดสุทธิวันนี้ − เมื่อวาน) ÷ เมื่อวาน × 100 (วันนี้ยังไม่จบวัน ตัวเลขอาจเพิ่มขึ้นอีก)" },
  );

  // 2) แนวโน้ม 7 วัน
  const t = trendOf(net);
  const trendFormula = "ถดถอยเชิงเส้นของยอดสุทธิรายวัน 7 วัน: เปลี่ยนแปลง% = slope × 6 ÷ ค่าเฉลี่ย × 100; ภายใน ±5% = ทรงตัว; ต้องมียอดขายอย่างน้อย 3 วัน";
  out.push(
    t.direction === "INSUFFICIENT"
      ? { id: "trend", severity: "info", title: "แนวโน้มยอดขาย 7 วัน: ข้อมูลยังไม่พอ", detail: `มียอดขายเพียง ${t.daysWithSales} จาก 7 วัน (ต้องอย่างน้อย 3 วัน)`, formula: trendFormula }
      : { id: "trend", severity: t.direction === "UP" ? "good" : t.direction === "DOWN" ? "warn" : "info", title: `แนวโน้มยอดขาย 7 วัน: ${t.direction === "UP" ? "เพิ่มขึ้น" : t.direction === "DOWN" ? "ลดลง" : "ทรงตัว"} (${pct(t.changePct)})`, detail: `ยอดเฉลี่ยต่อวัน ${formatMoney(t.mean)}`, formula: trendFormula },
  );

  // 3) สินค้าขายดี
  out.push(
    d.top7.length === 0
      ? { id: "best", severity: "info", title: "สินค้าขายดี 7 วัน", detail: "ยังไม่มียอดขายใน 7 วันที่ผ่านมา", formula: "จัดอันดับตามจำนวนชิ้นสุทธิ (หักที่คืน) ใน 7 วันล่าสุด" }
      : { id: "best", severity: "good", title: `สินค้าขายดี 7 วัน: ${d.top7[0].name}`, detail: `อันดับ 1 ขายได้ ${d.top7[0].units} ชิ้น (${formatMoney(d.top7[0].revenue)})`, formula: "จัดอันดับตามจำนวนชิ้นสุทธิ (หักที่คืน) ใน 7 วันล่าสุด", items: d.top7.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} — ${p.units} ชิ้น`) },
  );

  // 4) ควรสั่งเพิ่ม
  const re = restockSuggestions(d.stock);
  if (re.length > 0) {
    out.push({
      id: "restock", severity: "warn", title: `ควรสั่งเพิ่ม ${re.length} รายการ`, detail: "สต็อกเหลือขายได้ไม่ถึง 7 วัน หรือถึงขั้นต่ำแล้ว",
      formula: "วันที่สต็อกพอขาย = สต็อก ÷ ยอดขายเฉลี่ยต่อวัน (14 วัน); เตือนเมื่อ < 7 วัน หรือ สต็อก ≤ ขั้นต่ำ; จำนวนแนะนำ = เฉลี่ย/วัน × 14 − สต็อก",
      items: re.slice(0, 8).map((p) => `${p.name} — เหลือ ${p.stock} ${p.cover === null ? "(ไม่มียอดขายล่าสุด)" : `(พอขาย ~${p.cover.toFixed(1)} วัน)`}${p.suggest > 0 ? ` · แนะนำเพิ่ม ~${p.suggest}` : ""}`),
    });
  }

  // 5) ขายช้า
  if (d.slow.length > 0) {
    out.push({
      id: "slow", severity: "info", title: `สินค้าขายช้า ${d.slow.length} รายการ`, detail: "มีสต็อกแต่ไม่มียอดขายใน 14 วัน — ควรพิจารณาจัดโปรโมชั่นหรือลดการสั่งซื้อ",
      formula: "สินค้าที่เปิดขาย มีสต็อก > 0 และไม่มีรายการขายสำเร็จใน 14 วันล่าสุด", items: d.slow.slice(0, 8).map((p) => `${p.name} — คงเหลือ ${p.stock}`),
    });
  }

  // 6) สต็อกใกล้หมดอายุ
  if (d.expiring.units > 0) {
    out.push({
      id: "expiring", severity: "warn", title: `สต็อกใกล้หมดอายุ ${d.expiring.units} ชิ้น (ทุน ${formatMoney(d.expiring.costValue)})`, detail: `จะหมดอายุภายใน ${d.nearDays} วัน — ควรเร่งระบายด้วยโปรโมชั่น`,
      formula: `ล็อตที่ยังไม่หมดอายุและวันหมดอายุอยู่ภายใน ${d.nearDays} วัน: มูลค่า = Σ จำนวนคงเหลือ × ทุนต่อหน่วยของล็อต`, items: d.expiring.names.slice(0, 8),
    });
  }
  return out;
}

/* ───────────── ดึงข้อมูลจริงแล้วสร้าง Insight ───────────── */

export async function loadInsights(): Promise<{ insights: Insight[]; generatedFor: string }> {
  const today = todayBangkokKey();
  const r7 = lastNDays(7);
  const r14 = lastNDays(14);
  const nearDays = await getNearExpiryDays();
  const startOf = (k: string) => new Date(`${k}T00:00:00+07:00`);
  const since14 = startOf(r14.from);
  const nearLimit = new Date(`${today}T00:00:00.000Z`);
  nearLimit.setUTCDate(nearLimit.getUTCDate() + nearDays);

  const [report7, top7, avgRows, products, slowRows, expRows] = await Promise.all([
    salesReport(r7),
    topProducts(r7, 5),
    db.$queryRaw<{ productId: string; units: bigint }[]>`
      SELECT i."productId", SUM(i.quantity - i."returnedQty") AS units
      FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
      WHERE s.status IN ('COMPLETED','PARTIALLY_RETURNED','FULLY_RETURNED') AND s."createdAt" >= ${since14}
      GROUP BY i."productId"`,
    db.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true, stockQty: true, minStock: true } }),
    db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Product" p
      WHERE p."isActive" AND p."stockQty" > 0 AND NOT EXISTS (
        SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
        WHERE i."productId" = p.id AND s.status IN ('COMPLETED','PARTIALLY_RETURNED','FULLY_RETURNED') AND s."createdAt" >= ${since14})`,
    db.productBatch.findMany({
      where: { remainingQty: { gt: 0 }, expiryDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: nearLimit }, product: { isActive: true } },
      select: { remainingQty: true, costPrice: true, expiryDate: true, product: { select: { name: true } } },
    }),
  ]);

  const units14 = new Map(avgRows.map((r) => [r.productId, Number(r.units)]));
  const byId = new Map(products.map((p) => [p.id, p]));
  const stock: StockCandidate[] = products
    .filter((p) => p.stockQty > 0)
    .map((p) => ({ name: p.name, sku: p.sku, stock: p.stockQty, minStock: p.minStock, avgDaily: (units14.get(p.id) ?? 0) / 14 }));
  const slow = slowRows.map((s) => byId.get(s.id)!).filter(Boolean).map((p) => ({ name: p.name, sku: p.sku, stock: p.stockQty }));
  const expiring = {
    units: expRows.reduce((a, b) => a + b.remainingQty, 0),
    costValue: expRows.reduce((a, b) => a.add(b.costPrice.mul(b.remainingQty)), new Prisma.Decimal(0)).toFixed(2),
    names: expRows.map((b) => `${b.product.name} — ${b.remainingQty} ชิ้น (หมดอายุ ${b.expiryDate!.toISOString().slice(0, 10)})`),
  };

  return { insights: buildInsights({ today, series7: report7.rows, top7, stock, slow, expiring, nearDays }), generatedFor: today };
}
