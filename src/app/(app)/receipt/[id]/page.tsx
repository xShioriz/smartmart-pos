import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { getReceipt } from "@/server/services/sales";
import { PrintButton } from "./print-button";

const METHOD_LABEL: Record<string, string> = { CASH: "เงินสด", PROMPTPAY: "PromptPay QR" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const id = z.string().uuid().safeParse((await params).id).data;
  if (!id) notFound();
  const data = await getReceipt(id, user);
  if (!data) notFound();
  const { store, sale } = data;
  const hasDiscount = Number(sale.discountTotal) > 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/sales" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> ประวัติการขาย</Link>
        <div className="flex gap-2">
          <PrintButton />
          <Link href="/pos"><Button><ShoppingCart /> ขายรายการใหม่</Button></Link>
        </div>
      </div>

      <article className="receipt mx-auto w-[80mm] max-w-full rounded-xl border bg-white p-4 font-mono text-[12px] leading-5 text-black shadow-sm print:rounded-none print:border-0 print:shadow-none" aria-label={`ใบเสร็จ ${sale.receiptNo}`}>
        <header className="text-center">
          <p className="text-base font-bold">{store.name}</p>
          {store.address && <p>{store.address}</p>}
          {store.phone && <p>โทร {store.phone}</p>}
          <p className="mt-2 font-bold">ใบเสร็จรับเงิน</p>
        </header>
        <div className="my-2 border-t border-dashed border-black" />
        <dl className="space-y-0.5">
          <div className="flex justify-between gap-2"><dt>เลขที่</dt><dd>{sale.receiptNo}</dd></div>
          <div className="flex justify-between gap-2"><dt>วันที่</dt><dd>{formatDateTime(new Date(sale.createdAt))}</dd></div>
          <div className="flex justify-between gap-2"><dt>พนักงาน</dt><dd>{sale.cashier}</dd></div>
        </dl>
        <div className="my-2 border-t border-dashed border-black" />
        <table className="w-full">
          <thead>
            <tr className="text-left"><th className="font-normal">รายการ</th><th className="text-right font-normal">จำนวน</th><th className="text-right font-normal">ราคา</th><th className="text-right font-normal">รวม</th></tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="max-w-[28mm] break-words pr-1">{i.name}</td>
                <td className="text-right tabular-nums">{i.quantity}</td>
                <td className="text-right tabular-nums">{i.unitPrice}</td>
                <td className="text-right tabular-nums">{i.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="my-2 border-t border-dashed border-black" />
        <dl className="space-y-0.5">
          {hasDiscount && (
            <>
              <div className="flex justify-between"><dt>รวมก่อนลด</dt><dd className="tabular-nums">{formatMoney(sale.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>ส่วนลด</dt><dd className="tabular-nums">-{formatMoney(sale.discountTotal)}</dd></div>
            </>
          )}
          <div className="flex justify-between text-sm font-bold"><dt>ยอดสุทธิ</dt><dd className="tabular-nums">{formatMoney(sale.total)}</dd></div>
          <div className="flex justify-between"><dt>ชำระโดย</dt><dd>{METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod}</dd></div>
          <div className="flex justify-between"><dt>รับเงิน</dt><dd className="tabular-nums">{formatMoney(sale.amountPaid)}</dd></div>
          <div className="flex justify-between"><dt>เงินทอน</dt><dd className="tabular-nums">{formatMoney(sale.change)}</dd></div>
        </dl>
        {sale.status !== "COMPLETED" && <p className="mt-2 text-center font-bold">** {sale.status === "FULLY_RETURNED" ? "คืนสินค้าทั้งบิล" : "มีการคืนสินค้าบางส่วน"} **</p>}
        {store.footer && (<><div className="my-2 border-t border-dashed border-black" /><p className="text-center">{store.footer}</p></>)}
      </article>
    </>
  );
}
