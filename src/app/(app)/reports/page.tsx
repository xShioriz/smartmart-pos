import { Banknote, BarChart3, Download, Percent, QrCode, Receipt, Undo2, Wallet } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalesChart } from "@/components/charts/sales-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { InsightList } from "@/components/shared/insight-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { loadInsights } from "@/server/services/bi";
import { daysBetween, lastNDays, salesReport, topProducts, type DateRange } from "@/server/services/reports";

const MAX_DAYS = 366;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const f = date.safeParse(sp.from).data, t = date.safeParse(sp.to).data;
  let range: DateRange = lastNDays(30);
  let notice: string | null = null;
  if (f && t) {
    if (f > t) notice = "วันเริ่มต้นต้องไม่หลังวันสิ้นสุด — แสดงข้อมูล 30 วันล่าสุดแทน";
    else if (daysBetween({ from: f, to: t }).length > MAX_DAYS) notice = `เลือกช่วงได้ไม่เกิน ${MAX_DAYS} วัน — แสดงข้อมูล 30 วันล่าสุดแทน`;
    else range = { from: f, to: t };
  }
  const [rep, top, bi] = await Promise.all([salesReport(range), topProducts(range, 10), loadInsights()]);
  const tot = rep.totals;
  const hasData = tot.bills > 0 || Number(tot.refunds) > 0;
  const cashPct = Number(tot.gross) > 0 ? Math.round((Number(tot.cash) / Number(tot.gross)) * 100) : 0;

  return (
    <>
      <PageHeader title="รายงานยอดขาย" description={`ช่วงวันที่ ${range.from} ถึง ${range.to} (เวลาไทย)`} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <Input name="from" type="date" defaultValue={range.from} aria-label="ตั้งแต่วันที่" className="w-44" />
        <span className="text-sm text-muted-foreground">ถึง</span>
        <Input name="to" type="date" defaultValue={range.to} aria-label="ถึงวันที่" className="w-44" />
        <Button type="submit" variant="outline"><BarChart3 /> แสดงรายงาน</Button>
        <span className="ml-auto flex flex-wrap gap-2">
          <a href={`/reports/export?type=daily&from=${range.from}&to=${range.to}`} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-muted">
            <Download className="size-4" /> CSV สรุปรายวัน
          </a>
          <a href={`/reports/export?type=products&from=${range.from}&to=${range.to}`} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-muted">
            <Download className="size-4" /> CSV สินค้าขายดี
          </a>
        </span>
      </form>
      {notice && <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="ยอดขายสุทธิ" value={formatMoney(tot.net)} icon={Wallet} hint={`ยอดขาย ${formatMoney(tot.gross)} − เงินคืน ${formatMoney(tot.refunds)}`} />
        <StatCard title="จำนวนรายการขาย" value={`${tot.bills.toLocaleString("th-TH")} บิล`} icon={Receipt} hint={`เฉลี่ยต่อบิล ${formatMoney(tot.avgBill)} (ก่อนหักคืน)`} />
        <StatCard title="กำไรขั้นต้น" value={formatMoney(tot.profit)} icon={Percent} hint="หลังส่วนลดและการคืนสินค้า คิดจากต้นทุนล็อตที่ขายจริง" />
        <StatCard title="เงินคืน (คืนสินค้า)" value={formatMoney(tot.refunds)} icon={Undo2} tone={Number(tot.refunds) > 0 ? "warn" : "default"} hint="นับตามวันที่คืนสินค้า" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <StatCard title="ชำระด้วยเงินสด" value={formatMoney(tot.cash)} icon={Banknote} hint={`${cashPct}% ของยอดขาย`} />
        <StatCard title="ชำระด้วย PromptPay QR" value={formatMoney(tot.qr)} icon={QrCode} hint={`${hasData ? 100 - cashPct : 0}% ของยอดขาย`} />
      </div>

      {!hasData ? (
        <div className="mt-4"><EmptyState icon={BarChart3} title="ไม่มีข้อมูลการขายในช่วงนี้" description="ลองเลือกช่วงวันที่อื่น หรือขายสินค้าที่หน้า POS" /></div>
      ) : (
        <>
          <section className="mt-4 rounded-xl border bg-card p-4">
            <h2 className="mb-2 font-semibold">ยอดขายสุทธิรายวัน</h2>
            <SalesChart data={rep.rows.map((r) => ({ day: r.day, net: Number(r.net), bills: r.bills }))} />
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <section className="overflow-x-auto rounded-xl border bg-card xl:col-span-2">
              <h2 className="p-4 pb-2 font-semibold">สรุปรายวัน</h2>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>วันที่</TableHead><TableHead className="text-right">บิล</TableHead><TableHead className="text-right">ยอดขาย</TableHead>
                    <TableHead className="text-right">เงินคืน</TableHead><TableHead className="text-right">สุทธิ</TableHead><TableHead className="text-right">กำไร</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...rep.rows].reverse().map((r) => (
                    <TableRow key={r.day} className={r.bills === 0 && Number(r.refunds) === 0 ? "text-muted-foreground" : ""}>
                      <TableCell className="tabular-nums">{r.day}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.bills}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.refunds) > 0 ? `-${formatMoney(r.refunds)}` : "-"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.net)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.profit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">รวม</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{tot.bills}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(tot.gross)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">-{formatMoney(tot.refunds)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(tot.net)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(tot.profit)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </section>

            <section className="overflow-x-auto rounded-xl border bg-card">
              <h2 className="p-4 pb-2 font-semibold">สินค้าขายดี (สุทธิหลังคืน)</h2>
              {top.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">ไม่มีข้อมูล</p>
              ) : (
                <Table>
                  <TableHeader><TableRow className="bg-muted/50"><TableHead>#</TableHead><TableHead>สินค้า</TableHead><TableHead className="text-right">ชิ้น</TableHead><TableHead className="text-right">รายได้</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {top.map((p, i) => (
                      <TableRow key={p.productId}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell><div className="max-w-40 truncate font-medium" title={p.name}>{p.name}</div><div className="font-mono text-xs text-muted-foreground">{p.sku}</div></TableCell>
                        <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(p.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        </>
      )}

      <div className="mt-4">
        <InsightList insights={bi.insights} title="Smart BI — การวิเคราะห์ธุรกิจ" />
        <p className="mt-2 text-xs text-muted-foreground">การวิเคราะห์ใช้ข้อมูลล่าสุดเสมอ (7/14 วันย้อนหลังจากวันนี้) ไม่ขึ้นกับช่วงวันที่ที่เลือกด้านบน</p>
      </div>
    </>
  );
}
