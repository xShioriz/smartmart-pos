// ส่งออกรายงานเป็น CSV (ADMIN เท่านั้น) — ใช้ฟังก์ชันรายงานตัวเดียวกับหน้าจอ ตัวเลขจึงตรงกันเสมอ
import { z } from "zod";
import { AuthError, requireAction } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { toCsv } from "@/lib/csv";
import { daysBetween, salesReport, topProducts } from "@/server/services/reports";

export const dynamic = "force-dynamic";
const MAX_DAYS = 366;

const query = z.object({
  type: z.enum(["daily", "products"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const bad = (msg: string, status = 400) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAction(["ADMIN"]);
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message, e.code === "UNAUTHENTICATED" ? 401 : 403);
    throw e;
  }
  const sp = new URL(req.url).searchParams;
  const q = query.safeParse({ type: sp.get("type"), from: sp.get("from"), to: sp.get("to") });
  if (!q.success) return bad("พารามิเตอร์ไม่ถูกต้อง (type=daily|products, from/to=yyyy-MM-dd)");
  const { type, from, to } = q.data;
  if (from > to) return bad("วันเริ่มต้นต้องไม่หลังวันสิ้นสุด");
  const range = { from, to };
  const valid = (s: string) => { const d = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
  if (!valid(from) || !valid(to)) return bad("วันที่ไม่ถูกต้อง");
  if (daysBetween(range).length > MAX_DAYS) return bad(`เลือกช่วงได้ไม่เกิน ${MAX_DAYS} วัน`);

  let rows;
  if (type === "daily") {
    const { rows: d, totals: t } = await salesReport(range);
    rows = [
      ["วันที่", "จำนวนบิล", "ยอดขาย", "เงินคืน", "ยอดขายสุทธิ", "กำไรขั้นต้น", "เงินสด", "PromptPay QR"],
      ...d.map((r) => [r.day, r.bills, { num: r.gross }, { num: r.refunds }, { num: r.net }, { num: r.profit }, { num: r.cash }, { num: r.qr }]),
      ["รวม", t.bills, { num: t.gross }, { num: t.refunds }, { num: t.net }, { num: t.profit }, { num: t.cash }, { num: t.qr }],
    ];
  } else {
    const top = await topProducts(range, 1000);
    rows = [["อันดับ", "รหัสสินค้า (SKU)", "ชื่อสินค้า", "จำนวนที่ขายสุทธิ", "รายได้สุทธิ"], ...top.map((p, i) => [i + 1, p.sku, p.name, p.units, { num: p.revenue }])];
  }

  await audit(db, { userId: user.id, action: "REPORT_EXPORT", entity: "Report", after: { type, from, to } });
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="smartmart-${type}-${from}_${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
