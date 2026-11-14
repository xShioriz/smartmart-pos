import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { getSaleDetail } from "@/server/services/sales";
import { ResolveReview } from "./resolve-review";
import { ReturnDialog } from "./return-dialog";

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "รอชำระเงิน", COMPLETED: "สำเร็จ", PARTIALLY_RETURNED: "คืนบางส่วน", FULLY_RETURNED: "คืนทั้งบิล", CANCELLED: "ยกเลิก", PAID_NEEDS_REVIEW: "จ่ายแล้ว — ต้องตรวจสอบ",
};
const PAY_STATUS: Record<string, string> = { PENDING: "รอชำระ", PAID: "ชำระแล้ว", FAILED: "ไม่สำเร็จ/ยกเลิก", EXPIRED: "หมดอายุ" };
const METHOD: Record<string, string> = { CASH: "เงินสด", PROMPTPAY: "PromptPay QR" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const id = z.string().uuid().safeParse((await params).id).data;
  if (!id) notFound();
  const sale = await getSaleDetail(id, user);
  if (!sale) notFound();
  const pay = sale.payment;

  return (
    <>
      <Link href="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> ประวัติการขาย</Link>
      <PageHeader
        eyebrow="Sale"
        title={sale.receiptNo ?? "บิลที่ยังไม่มีเลขใบเสร็จ"}
        description={`${formatDateTime(new Date(sale.createdAt))} · พนักงาน ${sale.cashier}`}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={sale.status === "COMPLETED" ? "outline" : sale.status === "PAID_NEEDS_REVIEW" ? "destructive" : "secondary"}>{STATUS[sale.status] ?? sale.status}</Badge>
            {sale.receiptNo && <Link href={`/receipt/${sale.id}`}><Button variant="outline" size="sm"><Receipt /> ดูใบเสร็จ</Button></Link>}
            {sale.canReturn && <ReturnDialog saleId={sale.id} items={sale.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, returnedQty: i.returnedQty }))} isQr={sale.isQr} />}
          </div>
        }
      />

      {sale.status === "PAID_NEEDS_REVIEW" && user.role === "ADMIN" && <div className="mb-4"><ResolveReview saleId={sale.id} /></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="overflow-x-auto rounded-xl border bg-card lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50"><TableHead>สินค้า</TableHead><TableHead className="text-right">จำนวน</TableHead><TableHead className="text-right">คืนแล้ว</TableHead><TableHead className="text-right">ราคา/หน่วย</TableHead><TableHead className="text-right">ส่วนลด</TableHead><TableHead className="text-right">สุทธิ</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {sale.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell><div className="font-medium">{i.name}</div><div className="font-mono text-sm text-muted-foreground">{i.sku}</div>{i.promotionName && <div className="text-sm text-success">{i.promotionName}</div>}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.returnedQty > 0 ? i.returnedQty : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(i.discount) > 0 ? `-${formatMoney(i.discount)}` : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(i.net)}</TableCell>
                </TableRow>
              ))}
              {Number(sale.billDiscount) > 0 && <TableRow><TableCell colSpan={5} className="text-right text-sm text-muted-foreground">รวมส่วนลดทั้งบิลที่กระจายในรายการข้างต้น{sale.billPromotionName ? ` (${sale.billPromotionName})` : ""}</TableCell><TableCell className="text-right tabular-nums">-{formatMoney(sale.billDiscount)}</TableCell></TableRow>}
              <TableRow><TableCell colSpan={5} className="text-right font-semibold">ยอดสุทธิ</TableCell><TableCell className="text-right text-base font-bold tabular-nums">{formatMoney(sale.total)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </section>

        <aside className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <h2 className="mb-2 font-semibold">การชำระเงิน</h2>
          <Row k="วิธีชำระ" v={METHOD[sale.paymentMethod] ?? sale.paymentMethod} />
          {sale.member && <Row k="สมาชิก" v={`${sale.member.code} ${sale.member.name}`} />}
          {sale.member && <Row k="แต้มที่ได้" v={String(sale.pointsEarned)} />}
          {pay ? (
            <>
              <Row k="สถานะ" v={PAY_STATUS[pay.status] ?? pay.status} />
              <Row k="ยอดที่ต้องชำระ" v={formatMoney(pay.amount)} />
              {pay.provider && <Row k="Provider" v={`${pay.provider} (${pay.environment === "SANDBOX" ? "SANDBOX — ไม่ใช่เงินจริง" : "Production"})`} />}
              {pay.chargeRef && <Row k="อ้างอิง" v={pay.chargeRef} mono />}
              {pay.paidAt && <Row k="ชำระเมื่อ" v={formatDateTime(new Date(pay.paidAt))} />}
              {pay.confirmedVia && <Row k="ยืนยันโดย" v={pay.confirmedVia === "webhook" ? "Webhook จาก Provider" : "ตรวจสอบกับ Provider (reconcile)"} />}
              {pay.failureReason && <Row k="หมายเหตุ" v={pay.failureReason === "CANCELLED_BY_CASHIER" ? "ยกเลิกโดยแคชเชียร์" : pay.failureReason} />}
            </>
          ) : <p className="text-muted-foreground">ไม่มีข้อมูลการชำระเงิน</p>}
          {sale.paymentMethod === "CASH" && (<><Row k="รับเงิน" v={formatMoney(sale.amountPaid)} /><Row k="เงินทอน" v={formatMoney(sale.change)} /></>)}
        </aside>
      </div>

      {sale.returns.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">ประวัติการคืนสินค้า</h2>
          <div className="space-y-3">
            {sale.returns.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-sm font-medium">{r.returnNo} <span className="font-sans text-muted-foreground">· {formatDateTime(new Date(r.createdAt))} · โดย {r.by}</span></p>
                  <p className="text-base font-semibold tabular-nums text-primary">คืนเงิน {formatMoney(r.refundTotal)}</p>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {r.items.map((i) => <li key={i.id} className="flex justify-between"><span>{i.name} × {i.quantity}{i.restock ? "" : " (ของเสีย ไม่คืนสต็อก)"}</span><span className="tabular-nums">{formatMoney(i.refund)}</span></li>)}
                </ul>
                <p className="mt-2 text-sm text-muted-foreground">เหตุผล: {r.reason}{r.refundNote ? ` · ${r.refundNote}` : ""}{r.pointsReversed > 0 ? ` · หักแต้ม ${r.pointsReversed}` : ""}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className={mono ? "font-mono text-sm" : "text-right"}>{v}</span></div>;
}
