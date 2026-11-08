import { Banknote, Calculator, QrCode, Undo2, Vault } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { requirePage } from "@/server/auth/guard";
import { db } from "@/server/db";
import { computeFigures, getOpenShift, listShifts } from "@/server/services/shifts";
import { CloseShiftForm, OpenShiftForm } from "./shift-forms";

export default async function ShiftsPage() {
  const user = await requirePage(["ADMIN", "CASHIER"]);
  const open = await getOpenShift();
  const fig = open ? await computeFigures(db, open.openingCash, open.openedAt, new Date()) : null;
  const history = user.role === "ADMIN" ? await listShifts(30) : [];

  return (
    <>
      <PageHeader title="ปิดกะ / นับเงินสด" description="เปิดกะด้วยเงินทอนตั้งต้น แล้วปิดกะด้วยเงินที่นับได้จริง ระบบเทียบกับยอดเงินสดที่ควรมีในลิ้นชักให้" />

      {!open || !fig ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Vault className="size-5" /> ยังไม่มีกะที่เปิดอยู่</h2>
          <OpenShiftForm />
        </section>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            กะ #{open.shiftNo} · เปิดโดย {open.openedBy.name} เมื่อ {formatDateTime(open.openedAt)} <Badge className="ml-1" variant="secondary">เปิดอยู่</Badge>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="เงินทอนตั้งต้น" value={formatMoney(open.openingCash)} icon={Vault} />
            <StatCard title="ยอดขายเงินสดในกะนี้" value={formatMoney(fig.cashSales)} icon={Banknote} hint={`${fig.billCount} บิลเงินสด`} />
            <StatCard title="เงินคืนบิลเงินสด" value={formatMoney(fig.cashRefunds)} icon={Undo2} tone={Number(fig.cashRefunds) > 0 ? "warn" : "default"} />
            <StatCard title="เงินสดที่ควรมีในลิ้นชัก" value={formatMoney(fig.expected)} icon={Calculator} hint="ตั้งต้น + ขายเงินสด − เงินคืน" />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><QrCode className="size-4" /> ยอด PromptPay QR ในกะนี้ {formatMoney(fig.qrSales)} — ไม่เข้าลิ้นชัก จึงไม่นับในยอดที่ควรมี</p>

          <section className="mt-4 rounded-xl border bg-card p-5">
            <h2 className="mb-3 font-semibold">ปิดกะ</h2>
            <CloseShiftForm shiftId={open.id} expected={fig.expected} />
          </section>
        </>
      )}

      {user.role === "ADMIN" && (
        <section className="mt-6 overflow-x-auto rounded-xl border bg-card">
          <h2 className="p-4 pb-2 font-semibold">ประวัติกะ (30 กะล่าสุด)</h2>
          {history.length === 0 ? (
            <div className="p-4"><EmptyState icon={Vault} title="ยังไม่มีประวัติกะ" description="เมื่อเปิดและปิดกะ ข้อมูลจะแสดงที่นี่" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>กะ</TableHead><TableHead>เปิด</TableHead><TableHead>ปิด</TableHead>
                  <TableHead className="text-right">ตั้งต้น</TableHead><TableHead className="text-right">ควรมี</TableHead><TableHead className="text-right">นับได้</TableHead>
                  <TableHead className="text-right">ผลต่าง</TableHead><TableHead>หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => {
                  const d = s.difference ? Number(s.difference) : 0;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">#{s.shiftNo}</TableCell>
                      <TableCell className="text-sm">{formatDateTime(s.openedAt)}<div className="text-xs text-muted-foreground">{s.openedBy.name}</div></TableCell>
                      <TableCell className="text-sm">{s.closedAt ? <>{formatDateTime(s.closedAt)}<div className="text-xs text-muted-foreground">{s.closedBy?.name}</div></> : <Badge variant="secondary">เปิดอยู่</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(s.openingCash)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.expectedCash ? formatMoney(s.expectedCash) : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.countedCash ? formatMoney(s.countedCash) : "-"}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${d < 0 ? "text-red-600" : d > 0 ? "text-amber-600" : ""}`}>
                        {s.difference === null ? "-" : d === 0 ? "ตรง" : `${d < 0 ? "ขาด" : "เกิน"} ${formatMoney(Math.abs(d))}`}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-sm text-muted-foreground" title={s.note ?? ""}>{s.note ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </>
  );
}
