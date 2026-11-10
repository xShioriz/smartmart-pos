import Link from "next/link";
import { AlertTriangle, Bell, CalendarClock, Package, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BillsChart, SalesChart } from "@/components/charts/sales-chart";
import { InsightList } from "@/components/shared/insight-card";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { compareDays } from "@/server/services/bi";
import { loadDashboard } from "@/server/services/dashboard";

const card = "rounded-xl border bg-card p-4 sm:p-5";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requirePage(["ADMIN"]);
  const range = (await searchParams).range === "30" ? 30 : 7;
  const d = await loadDashboard(range);
  const cmp = compareDays(Number(d.todayNet), Number(d.yesterdayNet));
  const noSales = Number(d.rangeTotals.gross) === 0;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="text-muted-foreground">สวัสดี,</span> {user.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาพรวมวันที่ {d.today} (เวลาไทย)</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="ยอดขายสุทธิวันนี้" value={formatMoney(d.todayNet)} icon={Wallet}
          hint={cmp === null ? <>เมื่อวาน {formatMoney(d.yesterdayNet)}</> : (
            <span className={cn("inline-flex items-center gap-1 font-medium", cmp >= 0 ? "text-emerald-700" : "text-red-600")}>
              {cmp >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />} {cmp >= 0 ? "+" : ""}{cmp.toFixed(1)}% จากเมื่อวาน ({formatMoney(d.yesterdayNet)})
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
              <h2 className="font-semibold">ยอดขายสุทธิรายวัน</h2>
              <p className="text-xs text-muted-foreground">รวม {range} วัน {formatMoney(d.rangeTotals.net)} · เฉลี่ยต่อบิล {formatMoney(d.rangeTotals.avgBill)}</p>
            </div>
            <div className="flex gap-1 rounded-md bg-muted p-0.5 text-sm" role="tablist" aria-label="ช่วงเวลา">
              {([7, 30] as const).map((n) => (
                <Link key={n} href={`/dashboard?range=${n}`} role="tab" aria-selected={range === n} className={cn("rounded-[4px] px-3 py-1 transition-colors", range === n ? "bg-card font-medium text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>{n} วัน</Link>
              ))}
            </div>
          </div>
          {noSales ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
          ) : <SalesChart data={d.chart} />}
        </section>

        <section className={card}>
          <div className="mb-3">
            <h2 className="font-semibold">จำนวนบิลรายวัน</h2>
            <p className="text-xs text-muted-foreground">รวม {range} วัน {d.rangeTotals.bills.toLocaleString("th-TH")} บิล</p>
          </div>
          {noSales ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
          ) : <BillsChart data={d.chart} />}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 font-semibold">สินค้าขายดี 7 วัน</h2>
          {d.top.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มียอดขาย</p>
          ) : (
            <ol className="space-y-2.5">
              {d.top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.units} ชิ้น</span>
                </li>
              ))}
            </ol>
          )}
          <Link href="/reports" className="mt-3 inline-block text-xs text-primary hover:underline">ดูรายงานทั้งหมด →</Link>
        </section>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">สต็อกที่ต้องดูแล</h2>
            {d.unread > 0 && <Link href="/notifications" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Bell className="size-3" /> แจ้งเตือนใหม่ {d.unread}</Link>}
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge className="bg-orange-100 text-orange-800"><CalendarClock className="size-3" /> ใกล้หมดอายุ {d.nearExpiryProducts}</Badge>
            <Badge variant={d.expiredProducts > 0 ? "destructive" : "outline"}>มีล็อตหมดอายุ {d.expiredProducts}</Badge>
          </div>
          {d.lowList.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">ไม่มีสินค้าใกล้หมด</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.lowList.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link href={`/inventory/${p.id}`} className="min-w-0 truncate hover:text-primary hover:underline">{p.name}</Link>
                  <span className="shrink-0 tabular-nums text-amber-700">{p.stock}/{p.min} {p.unit}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/inventory?filter=low" className="mt-3 inline-block text-xs text-primary hover:underline">ดูคลังสินค้า →</Link>
        </section>
      </div>

      <div className="mt-4">
        <InsightList insights={d.insights} limit={3} title="Smart BI สรุป" />
        <Link href="/reports" className="mt-2 inline-block text-xs text-primary hover:underline">ดูการวิเคราะห์ทั้งหมดที่หน้ารายงาน →</Link>
      </div>
    </>
  );
}
