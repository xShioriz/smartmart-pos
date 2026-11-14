import Link from "next/link";
import { ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { SortHead } from "@/components/shared/sort-head";
import { parseSort, sortLinks, type SortState } from "@/lib/sort";
import { SALES_SORT_KEYS, listSales, type SalesSortKey } from "@/server/services/sales";

const METHOD_LABEL: Record<string, string> = { CASH: "เงินสด", PROMPTPAY: "PromptPay QR" };
const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: "รอชำระเงิน", CANCELLED: "ยกเลิก", COMPLETED: "สำเร็จ", PARTIALLY_RETURNED: "คืนบางส่วน", FULLY_RETURNED: "คืนทั้งบิล", PAID_NEEDS_REVIEW: "จ่ายแล้ว — ต้องตรวจสอบ" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; date?: string; page?: string; view?: string; sort?: string; dir?: string }> }) {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 50) || undefined;
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(sp.date).data;
  const page = z.coerce.number().int().min(1).catch(1).parse(sp.page);
  const view = z.enum(["done", "review", "unfinished"]).catch("done").parse(sp.view);
  const sort = parseSort(SALES_SORT_KEYS, sp, { key: "time", dir: "desc" });
  const data = await listSales({ q, date, page, view, sort }, user);

  const url = (p: number, st: SortState<SalesSortKey>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (date) u.set("date", date);
    if (view !== "done") u.set("view", view);
    if (!(st.key === "time" && st.dir === "desc")) { u.set("sort", st.key); u.set("dir", st.dir); }
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/sales${s ? `?${s}` : ""}`;
  };
  const href = (p: number) => url(p, sort);
  const links = sortLinks(SALES_SORT_KEYS, sort, (st) => url(1, st), ["time", "items", "total"]);

  return (
    <>
      <PageHeader title="ประวัติการขาย" description={user.role === "ADMIN" ? `ทั้งหมด ${data.total.toLocaleString("th-TH")} บิล` : `บิลของคุณ ${data.total.toLocaleString("th-TH")} บิล`} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="sort" value={sort.key} />
        <input type="hidden" name="dir" value={sort.dir} />
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหาเลขที่ใบเสร็จ" aria-label="ค้นหาเลขที่ใบเสร็จ" className="w-60" />
        <Input name="date" type="date" defaultValue={date ?? ""} aria-label="วันที่" className="w-44" />
        <select name="view" defaultValue={view} aria-label="สถานะบิล" className="h-11 rounded-lg border border-input bg-card px-3 text-base">
          <option value="done">บิลที่เสร็จแล้ว</option>
          <option value="review">จ่ายแล้ว — ต้องตรวจสอบ</option>
          {user.role === "ADMIN" && <option value="unfinished">รอชำระ/ยกเลิก (QR)</option>}
        </select>
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
        {(q || date || view !== "done") && <Link href="/sales" className="text-sm text-muted-foreground hover:underline">ล้างตัวกรอง</Link>}
      </form>

      {data.rows.length === 0 ? (
        <EmptyState icon={Receipt} title={q || date || view !== "done" ? "ไม่พบรายการขายตามเงื่อนไข" : "ยังไม่มีรายการขาย"} description={q || date || view !== "done" ? undefined : "เมื่อมีการขายผ่านหน้า POS รายการจะแสดงที่นี่"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(3)]:hidden max-sm:[&_tr>:nth-child(4)]:hidden max-sm:[&_tr>:nth-child(6)]:hidden max-sm:[&_tr>:nth-child(8)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                <SortHead label="เลขที่ใบเสร็จ" {...links.receipt} /><SortHead label="วันเวลา" {...links.time} /><SortHead label="พนักงาน" {...links.cashier} />
                <SortHead label="รายการ" right {...links.items} /><SortHead label="ยอดสุทธิ" right {...links.total} /><SortHead label="ชำระโดย" {...links.method} /><SortHead label="สถานะ" {...links.status} /><TableHead className="text-right">รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link href={`/sales/${s.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{s.receiptNo ?? "(ยังไม่มีเลขที่) ดูรายละเอียด"}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(new Date(s.createdAt))}</TableCell>
                  <TableCell>{s.cashier}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.itemCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(s.total)}</TableCell>
                  <TableCell>{METHOD_LABEL[s.paymentMethod] ?? s.paymentMethod}</TableCell>
                  <TableCell><Badge variant={s.status === "COMPLETED" ? "outline" : s.status === "PAID_NEEDS_REVIEW" ? "destructive" : "secondary"}>{STATUS_LABEL[s.status] ?? s.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-3 text-xs">
                      <Link href={`/sales/${s.id}`} className="text-primary hover:underline">รายละเอียด{user.role === "ADMIN" && (s.status === "COMPLETED" || s.status === "PARTIALLY_RETURNED") ? " / คืนสินค้า" : ""}</Link>
                      {s.receiptNo && <Link href={`/receipt/${s.id}`} className="text-muted-foreground hover:underline">ใบเสร็จ</Link>}
                    </div>
                  </TableCell>
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
