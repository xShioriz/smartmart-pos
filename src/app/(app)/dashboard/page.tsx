import Link from "next/link";
import { AlertTriangle, Bell, CalendarClock, Package, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SalesChart } from "@/components/charts/sales-chart";
import { InsightList } from "@/components/shared/insight-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { compareDays } from "@/server/services/bi";
import { loadDashboard } from "@/server/services/dashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requirePage(["ADMIN"]);
  const range = (await searchParams).range === "30" ? 30 : 7;
  const d = await loadDashboard(range);
  const cmp = compareDays(Number(d.todayNet), Number(d.yesterdayNet));

  return (
    <>
      <PageHeader title="แดชบอร์ด" description={`ภาพรวมวันที่ ${d.today} (เวลาไทย)`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="ยอดขายสุทธิวันนี้" value={formatMoney(d.todayNet)} icon={Wallet}
          hint={cmp === null ? <>เมื่อวาน {formatMoney(d.yesterdayNet)}</> : (
            <span className={cn("inline-flex items-center gap-1", cmp >= 0 ? "text-green-700" : "text-red-600")}>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-4 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">ยอดขายสุทธิรายวัน</h2>
              <p className="text-xs text-muted-foreground">รวม {range} วัน {formatMoney(d.rangeTotals.net)} · {d.rangeTotals.bills.toLocaleString("th-TH")} บิล · เฉลี่ยต่อบิล {formatMoney(d.rangeTotals.avgBill)}</p>
            </div>
            <div className="flex gap-1 rounded-lg border p-0.5 text-sm" role="tablist" aria-label="ช่วงเวลา">
              {([7, 30] as const).map((n) => (
                <Link key={n} href={`/dashboard?range=${n}`} role="tab" aria-selected={range === n} className={cn("rounded-md px-3 py-1", range === n ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{n} วัน</Link>
              ))}
            </div>
          </div>
          {Number(d.rangeTotals.gross) === 0 ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
          ) : <SalesChart data={d.chart} />}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">สินค้าขายดี 7 วัน</h2>
          {d.top.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มียอดขาย</p>
          ) : (
            <ol className="space-y-2">
              {d.top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-semibold text-green-700">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.units} ชิ้น</span>
                </li>
              ))}
            </ol>
          )}
          <Link href="/reports" className="mt-3 inline-block text-xs text-primary hover:underline">ดูรายงานทั้งหมด →</Link>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-4">
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

        <div className="lg:col-span-2">
          <InsightList insights={d.insights} limit={3} title="Smart BI สรุป" />
          <Link href="/reports" className="mt-2 inline-block text-xs text-primary hover:underline">ดูการวิเคราะห์ทั้งหมดที่หน้ารายงาน →</Link>
        </div>
      </div>
    </>
  );
}
