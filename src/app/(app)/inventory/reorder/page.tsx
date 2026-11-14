import Link from "next/link";
import { ArrowLeft, Download, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { loadReorderList } from "@/server/services/bi";

export default async function ReorderPage() {
  await requirePage(["ADMIN", "OWNER"]);
  const list = await loadReorderList();
  const total = list.reduce((a, r) => a + Number(r.estCost), 0);

  return (
    <>
      <Link href="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> คลังสินค้า</Link>
      <PageHeader
        eyebrow="Reorder"
        title="รายการที่ควรสั่งซื้อ"
        description={`สินค้าที่ใกล้หมดหรือหมดแล้ว ${list.length.toLocaleString("th-TH")} รายการ · ประมาณการมูลค่า ${formatMoney(total)}`}
        action={
          <a href="/reports/export?type=restock" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted">
            <Download className="size-4" /> ดาวน์โหลด CSV
          </a>
        }
      />
      <p className="mb-4 rounded-xl border bg-card p-3 text-sm text-muted-foreground">
        วิธีคำนวณ: เตือนเมื่อ สต็อก ≤ ขั้นต่ำ หรือสต็อกพอขายน้อยกว่า 7 วัน (สต็อก ÷ ยอดขายเฉลี่ยต่อวันใน 14 วัน) · จำนวนที่ควรสั่ง = ยอดขายเฉลี่ย/วัน × 14 − สต็อก ·
        ถ้าต่ำกว่าขั้นต่ำแต่ไม่มียอดขายใน 14 วัน แนะนำเติมให้ถึง 2 × ขั้นต่ำ · เป็นคำแนะนำจากสถิติ ควรตรวจกับหน้าร้านก่อนสั่งจริง
      </p>

      {list.length === 0 ? (
        <EmptyState icon={PackageCheck} title="ไม่มีสินค้าที่ต้องสั่งเพิ่มตอนนี้" description="สต็อกทุกรายการพอขายเกิน 7 วันและสูงกว่าขั้นต่ำ" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(3)]:hidden max-sm:[&_tr>:nth-child(6)]:hidden max-sm:[&_tr>:nth-child(8)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                <TableHead>SKU</TableHead><TableHead>ชื่อสินค้า</TableHead><TableHead>หมวดหมู่</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead><TableHead className="text-right">ขั้นต่ำ</TableHead>
                <TableHead className="text-right">พอขายอีก</TableHead><TableHead className="text-right">ควรสั่ง</TableHead><TableHead className="text-right">ประมาณการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.sku}>
                  <TableCell className="font-mono text-sm">{r.sku}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.stock <= 0 ? <Badge variant="destructive">หมด</Badge> : <>{r.stock.toLocaleString("th-TH")} <span className="text-sm text-muted-foreground">{r.unit}</span></>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.minStock}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.cover === null ? <span className="text-muted-foreground">ไม่มียอดขาย</span> : `${r.cover.toFixed(1)} วัน`}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{r.suggest.toLocaleString("th-TH")} <span className="text-sm font-normal text-muted-foreground">{r.unit}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.estCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
