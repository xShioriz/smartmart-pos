import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { getMemberDetail } from "@/server/services/members";

const TYPE: Record<string, string> = { EARN: "ได้รับแต้ม", REDEEM: "ใช้แต้ม", RETURN_ADJUST: "ปรับจากการคืนสินค้า" };

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage(["ADMIN"]);
  const id = z.string().uuid().safeParse((await params).id).data;
  if (!id) notFound();
  const data = await getMemberDetail(id);
  if (!data) notFound();
  const { member: m, ledger, sales } = data;

  return (
    <>
      <Link href="/members" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> สมาชิก</Link>
      <PageHeader
        title={m.name}
        description={`${m.code} · ${m.phone}${m.email ? ` · ${m.email}` : ""}`}
        action={<Badge variant={m.isActive ? "outline" : "secondary"}>{m.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</Badge>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">แต้มคงเหลือ</p><p className="text-3xl font-bold tabular-nums text-primary">{m.points.toLocaleString("th-TH")}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">ยอดซื้อสะสม</p><p className="text-3xl font-bold tabular-nums">{formatMoney(m.totalSpent)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">สมัครเมื่อ</p><p className="text-lg font-semibold">{formatDateTime(new Date(m.createdAt))}</p></div>
      </div>

      <h2 className="mb-2 text-lg font-semibold">ประวัติแต้ม</h2>
      {ledger.length === 0 ? (
        <p className="mb-6 rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">ยังไม่มีรายการแต้ม</p>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow className="bg-lavender-50 hover:bg-lavender-50"><TableHead>เวลา</TableHead><TableHead>รายการ</TableHead><TableHead>ใบเสร็จ</TableHead><TableHead className="text-right">แต้ม</TableHead><TableHead className="text-right">คงเหลือ</TableHead></TableRow></TableHeader>
            <TableBody>
              {ledger.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(new Date(l.createdAt))}</TableCell>
                  <TableCell>{TYPE[l.type] ?? l.type}<span className="ml-2 text-xs text-muted-foreground">{l.note}</span></TableCell>
                  <TableCell>{l.saleId && l.receiptNo ? <Link href={`/sales/${l.saleId}`} className="font-mono text-xs text-primary hover:underline">{l.receiptNo}</Link> : "-"}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", l.points < 0 ? "text-red-600" : "text-green-700")}>{l.points > 0 ? "+" : ""}{l.points}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.balanceAfter}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mb-2 text-lg font-semibold">การซื้อล่าสุด</h2>
      {sales.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">ยังไม่มีรายการซื้อ</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow className="bg-lavender-50 hover:bg-lavender-50"><TableHead>ใบเสร็จ</TableHead><TableHead>เวลา</TableHead><TableHead className="text-right">ยอดสุทธิ</TableHead><TableHead className="text-right">แต้มที่ได้</TableHead></TableRow></TableHeader>
            <TableBody>
              {sales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link href={`/sales/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.receiptNo}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(new Date(s.createdAt))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(s.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.pointsEarned}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
