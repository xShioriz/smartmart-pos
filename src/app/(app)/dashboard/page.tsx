import Link from "next/link";
import { AlertTriangle, Bell, CalendarClock, Package, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BillsChart, SalesChart } from "@/components/charts/sales-chart";
import { InsightList } from "@/components/shared/insight-card";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { compareDays } from "@/server/services/bi";
import { todayBangkokKey } from "@/lib/date";
import { loadDashboard, resolveDashboardRange } from "@/server/services/dashboard";

const card = "rounded-xl border bg-card p-4 sm:p-5";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const resolved = resolveDashboardRange(sp, todayBangkokKey());
  const d = await loadDashboard(resolved.range);
  const range = d.rangeDays;
  const cmp = compareDays(Number(d.todayNet), Number(d.yesterdayNet));
  const noSales = Number(d.rangeTotals.gross) === 0;

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 font-heading text-sm font-semibold uppercase tracking-[0.2em] text-blue">Dashboard</p>
        <h1 className="font-heading text-page font-bold text-navy sm:text-display">
          <span className="font-semibold text-muted-foreground">สวัสดี,</span> {user.name}
        </h1>
        <span aria-hidden className="mt-2 block h-1 w-11 rounded-full bg-blue" />
        <p className="mt-3 text-sm text-muted-foreground">ภาพรวมวันที่ {d.today} (เวลาไทย)</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          featured title="ยอดขายสุทธิวันนี้" value={formatMoney(d.todayNet)} icon={Wallet}
          hint={cmp === null ? <>เมื่อวาน {formatMoney(d.yesterdayNet)}</> : (
            <span className="inline-flex items-center gap-1 font-semibold text-white">
              {cmp >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />} {cmp >= 0 ? "+" : ""}{cmp.toFixed(1)}% จากเมื่อวาน ({formatMoney(d.yesterdayNet)})
            </span>
          )}
        />
        <StatCard title="จำนวนรายการขายวันนี้" value={`${d.todayBills.toLocaleString("th-TH")} บิล`} icon={Receipt} hint={Number(d.todayRefunds) > 0 ? <>คืนเงินวันนี้ {formatMoney(d.todayRefunds)}</> : "ไม่มีการคืนเงินวันนี้"} />
        <StatCard title="สินค้าที่เปิดขาย" value={`${d.products.toLocaleString("th-TH")} รายการ`} icon={Package} hint={<Link href="/products" className="text-primary hover:underline">จัดการสินค้า</Link>} />
        <StatCard
          title="สินค้าใกล้หมด" value={`${d.lowStock + d.outOfStock} รายการ`} icon={AlertTriangle} tone={d.lowStock + d.outOfStock > 0 ? "warn" : "good"}
          hint={`ใกล้หมด ${d.lowStock} · หมดแล้ว ${d.outOfStock}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-heading text-lg font-semibold">ยอดขายสุทธิรายวัน</h2>
              <p className="text-sm text-muted-foreground">รวม {range} วัน {formatMoney(d.rangeTotals.net)} · เฉลี่ยต่อบิล {formatMoney(d.rangeTotals.avgBill)}</p>
            </div>
            <div className="flex gap-1 rounded-xl bg-lavender-100 p-1 text-sm" role="tablist" aria-label="ช่วงเวลา">
              {([7, 30] as const).map((n) => (
                <Link key={n} href={`/dashboard?range=${n}`} role="tab" aria-selected={resolved.preset === n} className={cn("inline-flex min-h-11 items-center rounded-lg px-4 font-heading font-semibold transition-colors", resolved.preset === n ? "bg-blue text-white" : "text-navy hover:bg-lavender")}>{n} วัน</Link>
              ))}
            </div>
          </div>
          <form className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label="เลือกช่วงวันที่เอง">
            <input type="date" name="from" defaultValue={resolved.range.from} max={d.today} aria-label="ตั้งแต่วันที่" className="h-11 rounded-lg border border-input bg-card px-3 text-base" />
            <span className="text-muted-foreground">ถึง</span>
            <input type="date" name="to" defaultValue={resolved.range.to} max={d.today} aria-label="ถึงวันที่" className="h-11 rounded-lg border border-input bg-card px-3 text-base" />
            <Button type="submit" variant="outline">ดูช่วงนี้</Button>
            {resolved.invalid && <span className="text-sm font-medium text-danger" role="alert">ช่วงวันที่ไม่ถูกต้อง (ต้องไม่เกินวันนี้ และไม่เกิน 366 วัน) — แสดง {range} วันล่าสุดแทน</span>}
          </form>
          {noSales ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
          ) : <SalesChart data={d.chart} />}
        </section>

        <section className={card}>
          <div className="mb-3">
            <h2 className="font-heading text-lg font-semibold">จำนวนบิลรายวัน</h2>
            <p className="text-sm text-muted-foreground">รวม {range} วัน {d.rangeTotals.bills.toLocaleString("th-TH")} บิล</p>
          </div>
          {noSales ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
          ) : <BillsChart data={d.chart} />}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 font-heading text-lg font-semibold">สินค้าขายดี 7 วัน</h2>
          {d.top.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มียอดขาย</p>
          ) : (
            <ol className="space-y-2.5">
              {d.top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lavender-100 font-heading text-sm font-semibold text-navy">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.units} ชิ้น</span>
                </li>
              ))}
            </ol>
          )}
          <Link href="/reports" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">ดูรายงานทั้งหมด →</Link>
        </section>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold">สต็อกที่ต้องดูแล</h2>
            {d.unread > 0 && <Link href="/notifications" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Bell className="size-4" /> แจ้งเตือนใหม่ {d.unread}</Link>}
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge variant="caution"><CalendarClock className="size-3" /> ใกล้หมดอายุ {d.nearExpiryProducts}</Badge>
            <Badge variant={d.expiredProducts > 0 ? "destructive" : "outline"}>มีล็อตหมดอายุ {d.expiredProducts}</Badge>
          </div>
          {d.lowList.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">ไม่มีสินค้าใกล้หมด</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.lowList.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link href={`/inventory/${p.id}`} className="min-w-0 truncate hover:text-primary hover:underline">{p.name}</Link>
                  <span className="shrink-0 tabular-nums font-medium text-warning">{p.stock}/{p.min} {p.unit}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/inventory?filter=low" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">ดูคลังสินค้า →</Link>
        </section>
      </div>

      <div className="mt-4">
        <InsightList insights={d.insights} limit={3} title="Smart BI สรุป" />
        <Link href="/reports" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">ดูการวิเคราะห์ทั้งหมดที่หน้ารายงาน →</Link>
      </div>
    </>
  );
}
