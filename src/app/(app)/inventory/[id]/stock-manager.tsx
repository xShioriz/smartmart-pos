"use client";

import { useState, useTransition } from "react";
import { PackagePlus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { formatMoney } from "@/lib/money";
import type { ActionResult } from "@/lib/result";
import { adjustStockAction, receiveStockAction } from "../actions";

type Batch = { id: string; batchNo: string; expiryDate: string | null; receivedAt: string; costPrice: string | null; initialQty: number; remainingQty: number; state: "OK" | "NEAR_EXPIRY" | "EXPIRED" };
type Dlg = { kind: "receive" } | { kind: "adjust"; batch: Batch } | null;

const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function StockManager({ isAdmin, productId, unit, defaultCost, batches }: { isAdmin: boolean; productId: string; unit: string; defaultCost: string | null; batches: Batch[] }) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const close = () => { setDlg(null); setError(null); };

  function submit(fn: () => Promise<ActionResult<unknown>>, okMsg: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(okMsg); close(); } else setError(res.error);
    });
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">ล็อตสินค้า (เรียงตามลำดับที่ระบบจะตัดขาย — FEFO)</h2>
        {isAdmin && <Button onClick={() => setDlg({ kind: "receive" })}><PackagePlus /> รับสินค้าเข้า</Button>}
      </div>

      {batches.length === 0 ? (
        <EmptyState icon={PackagePlus} title="ยังไม่มีล็อตสินค้า" description={isAdmin ? "กด “รับสินค้าเข้า” เพื่อเพิ่มสต็อกล็อตแรก" : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                <TableHead>เลขล็อต</TableHead><TableHead>หมดอายุ</TableHead><TableHead>รับเข้า</TableHead>
                {isAdmin && <TableHead className="text-right">ทุน/หน่วย</TableHead>}
                <TableHead className="text-right">รับเข้า (จำนวน)</TableHead><TableHead className="text-right">คงเหลือ</TableHead><TableHead>สถานะ</TableHead>
                {isAdmin && <TableHead className="text-right">จัดการ</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id} className={b.remainingQty === 0 ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-sm">{b.batchNo}</TableCell>
                  <TableCell className="tabular-nums">{b.expiryDate ?? "ไม่มี"}</TableCell>
                  <TableCell className="text-sm">{b.receivedAt.slice(0, 10)}</TableCell>
                  {isAdmin && <TableCell className="text-right tabular-nums">{b.costPrice ? formatMoney(b.costPrice) : "-"}</TableCell>}
                  <TableCell className="text-right tabular-nums">{b.initialQty}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{b.remainingQty}</TableCell>
                  <TableCell>
                    {b.remainingQty === 0 ? <Badge variant="outline">หมดล็อต</Badge>
                      : b.state === "EXPIRED" ? <Badge variant="destructive">หมดอายุ (ขายไม่ได้)</Badge>
                      : b.state === "NEAR_EXPIRY" ? <Badge variant="caution">ใกล้หมดอายุ</Badge>
                      : <Badge variant="outline">ปกติ</Badge>}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "adjust", batch: b })}><SlidersHorizontal /> ปรับ</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dlg?.kind === "receive"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {dlg?.kind === "receive" && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => String(f.get(k) ?? "");
                submit(() => receiveStockAction({ productId, qty: v("qty"), costPrice: v("costPrice"), expiryDate: v("expiryDate"), batchNo: v("batchNo"), note: v("note") }), "รับสินค้าเข้าแล้ว");
              }}
            >
              <DialogHeader>
                <DialogTitle>รับสินค้าเข้า</DialogTitle>
                <DialogDescription>สร้างล็อตใหม่ พร้อมบันทึกประวัติการเคลื่อนไหว</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label htmlFor="qty">จำนวน ({unit})</Label><Input id="qty" name="qty" required inputMode="numeric" autoFocus /></div>
                <div className="space-y-2"><Label htmlFor="costPrice">ทุนต่อหน่วย (บาท)</Label><Input id="costPrice" name="costPrice" required inputMode="decimal" defaultValue={defaultCost ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="expiryDate">วันหมดอายุ (ไม่บังคับ)</Label><Input id="expiryDate" name="expiryDate" type="date" /></div>
                <div className="space-y-2"><Label htmlFor="batchNo">เลขล็อต (เว้นว่าง = ออกให้อัตโนมัติ)</Label><Input id="batchNo" name="batchNo" maxLength={40} /></div>
                <div className="col-span-2 space-y-2"><Label htmlFor="note">หมายเหตุ (ไม่บังคับ)</Label><Input id="note" name="note" maxLength={200} /></div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={close}>ยกเลิก</Button><Button type="submit" disabled={pending}>บันทึก</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.kind === "adjust"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {dlg?.kind === "adjust" && (
            <form
              key={dlg.batch.id}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => String(f.get(k) ?? "");
                submit(() => adjustStockAction({ batchId: dlg.batch.id, mode: v("mode"), qty: v("qty"), reason: v("reason") }), "ปรับสต็อกแล้ว");
              }}
            >
              <DialogHeader>
                <DialogTitle>ปรับสต็อก ล็อต {dlg.batch.batchNo}</DialogTitle>
                <DialogDescription>คงเหลือปัจจุบัน {dlg.batch.remainingQty} {unit} — ต้องระบุเหตุผลทุกครั้ง (เช่น นับสต็อก, เสียหาย, หมดอายุ)</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="mode">รูปแบบ</Label>
                  <select id="mode" name="mode" className={selectClass} defaultValue="REMOVE">
                    <option value="REMOVE">ลดออก</option>
                    <option value="ADD">เพิ่มเข้า</option>
                    <option value="SET">ตั้งค่าเป็น</option>
                  </select>
                </div>
                <div className="space-y-2"><Label htmlFor="adj-qty">จำนวน</Label><Input id="adj-qty" name="qty" required inputMode="numeric" autoFocus /></div>
                <div className="col-span-2 space-y-2"><Label htmlFor="reason">เหตุผล</Label><Input id="reason" name="reason" required maxLength={200} /></div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={close}>ยกเลิก</Button><Button type="submit" disabled={pending}>ยืนยัน</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
