import Link from "next/link";
import { Boxes, ChevronLeft, ChevronRight, History, Search } from "lucide-react";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { listInventory, listMovements, type InventoryFilter } from "@/server/services/inventory";
import { syncNotifications } from "@/server/services/notifications";

const selectClass = "h-8 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const MOVEMENT_LABEL: Record<string, string> = { INITIAL: "ยอดยกมา", RESTOCK: "รับเข้า", SALE: "ขาย", ADJUSTMENT: "ปรับยอด", RETURN: "คืนสินค้า" };
const FILTER_LABEL: Record<InventoryFilter, string> = { all: "ทั้งหมด", low: "ใกล้หมด", out: "หมด", near_expiry: "ใกล้หมดอายุ", expired: "มีล็อตหมดอายุ" };

type SP = { tab?: string; q?: string; filter?: string; type?: string; page?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  if (sp.tab === "alerts") redirect("/notifications"); // ลิงก์เก่า: แจ้งเตือนย้ายไปหน้าเฉพาะแล้ว
  const tab = isAdmin ? z.enum(["stock", "movements"]).catch("stock").parse(sp.tab) : "stock";
  const q = sp.q?.trim().slice(0, 100) || undefined;

  const tabs = [
    { key: "stock", label: "คงเหลือ", icon: Boxes },
    ...(isAdmin ? [{ key: "movements", label: "ประวัติเคลื่อนไหว", icon: History }] : []),
  ];

  return (
    <>
      <PageHeader title="คลังสินค้า" description={isAdmin ? "ดูคงเหลือ รับสินค้าเข้า และปรับสต็อกราย ล็อต" : "ดูจำนวนคงเหลือ (อ่านอย่างเดียว)"} />
      <div className="mb-4 flex gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/inventory?tab=${t.key}`}
            className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm", tab === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <t.icon className="size-4" /> {t.label}
          </Link>
        ))}
      </div>
      {tab === "stock" && <StockTab q={q} filter={z.enum(["all", "low", "out", "near_expiry", "expired"]).catch("all").parse(sp.filter)} isAdmin={isAdmin} />}
      {tab === "movements" && <MovementsTab type={z.enum(["INITIAL", "RESTOCK", "SALE", "ADJUSTMENT", "RETURN"]).safeParse(sp.type).data} page={z.coerce.number().int().min(1).catch(1).parse(sp.page)} />}
    </>
  );
}

async function StockTab({ q, filter, isAdmin }: { q?: string; filter: InventoryFilter; isAdmin: boolean }) {
  if (isAdmin) await syncNotifications();
  const { rows, nearDays } = await listInventory({ q, filter, includeInactive: false });
  return (
    <>
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="tab" value="stock" />
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหา SKU / บาร์โค้ด / ชื่อ" aria-label="ค้นหาสินค้า" className="w-64" />
        <select name="filter" defaultValue={filter} aria-label="ตัวกรอง" className={selectClass}>
          {(Object.keys(FILTER_LABEL) as InventoryFilter[]).map((k) => <option key={k} value={k}>{FILTER_LABEL[k]}</option>)}
        </select>
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
        <span className="text-xs text-muted-foreground">“ใกล้หมดอายุ” = ภายใน {nearDays} วัน</span>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title={q || filter !== "all" ? "ไม่พบสินค้าตามเงื่อนไข" : "ยังไม่มีสินค้า"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>SKU</TableHead><TableHead>ชื่อสินค้า</TableHead><TableHead>หมวดหมู่</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead><TableHead className="text-right">ขายได้</TableHead>
                <TableHead className="text-right">ขั้นต่ำ</TableHead><TableHead>หมดอายุถัดไป</TableHead><TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell><Link href={`/inventory/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link></TableCell>
                  <TableCell>{r.categoryName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stockQty.toLocaleString("th-TH")} <span className="text-xs text-muted-foreground">{r.unit}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{r.sellableQty.toLocaleString("th-TH")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minStock}</TableCell>
                  <TableCell className="tabular-nums">{r.nextExpiry ?? "-"}</TableCell>
                  <TableCell className="space-x-1">
                    {r.status === "OUT" && <Badge variant="destructive">หมด</Badge>}
                    {r.status === "LOW" && <Badge className="bg-amber-100 text-amber-800">ใกล้หมด</Badge>}
                    {r.expiredQty > 0 && <Badge variant="destructive">หมดอายุ {r.expiredQty}</Badge>}
                    {r.nearExpiryQty > 0 && <Badge className="bg-orange-100 text-orange-800">ใกล้หมดอายุ {r.nearExpiryQty}</Badge>}
                    {r.status === "OK" && r.expiredQty === 0 && r.nearExpiryQty === 0 && <Badge variant="outline">ปกติ</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

async function MovementsTab({ type, page }: { type?: string; page: number }) {
  const data = await listMovements({ type, page });
  const href = (p: number) => `/inventory?tab=movements${type ? `&type=${type}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <form className="mb-4 flex items-center gap-2">
        <input type="hidden" name="tab" value="movements" />
        <select name="type" defaultValue={type ?? ""} aria-label="ประเภท" className={selectClass}>
          <option value="">ทุกประเภท</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Button type="submit" variant="outline">กรอง</Button>
      </form>
      {data.rows.length === 0 ? (
        <EmptyState icon={History} title="ยังไม่มีการเคลื่อนไหวสต็อก" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>เวลา</TableHead><TableHead>สินค้า</TableHead><TableHead>ล็อต</TableHead><TableHead>ประเภท</TableHead>
                <TableHead className="text-right">เปลี่ยนแปลง</TableHead><TableHead className="text-right">คงเหลือหลังรายการ</TableHead><TableHead>หมายเหตุ</TableHead><TableHead>โดย</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(new Date(m.createdAt))}</TableCell>
                  <TableCell><div className="font-medium">{m.productName}</div><div className="font-mono text-xs text-muted-foreground">{m.sku}</div></TableCell>
                  <TableCell className="text-xs">{m.batchNo ?? "-"}</TableCell>
                  <TableCell><Badge variant="outline">{MOVEMENT_LABEL[m.type] ?? m.type}</Badge></TableCell>
                  <TableCell className={cn("text-right tabular-nums font-medium", m.quantityChange < 0 ? "text-red-600" : "text-green-700")}>{m.quantityChange > 0 ? "+" : ""}{m.quantityChange}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={m.note ?? ""}>{m.note ?? "-"}</TableCell>
                  <TableCell className="text-xs">{m.by}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-end gap-3 text-sm" aria-label="เปลี่ยนหน้า">
          <span className="text-muted-foreground">หน้า {data.page} / {data.pageCount}</span>
          {data.page > 1 && <Link href={href(data.page - 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted"><ChevronLeft className="size-4" /> ก่อนหน้า</Link>}
          {data.page < data.pageCount && <Link href={href(data.page + 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted">ถัดไป <ChevronRight className="size-4" /></Link>}
        </nav>
      )}
    </>
  );
}

