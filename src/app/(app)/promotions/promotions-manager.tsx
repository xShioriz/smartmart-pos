"use client";

import { useState, useTransition } from "react";
import { Pencil, Percent, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortHead } from "@/components/shared/sort-head";
import type { SortLink } from "@/lib/sort";
import { EmptyState } from "@/components/shared/empty-state";
import { formatMoney } from "@/lib/money";
import { formatDateTime, toBangkokInput } from "@/lib/date";
import type { ActionResult } from "@/lib/result";
import { createPromotionAction, setPromotionActiveAction, updatePromotionAction } from "./actions";

type Item = {
  id: string; name: string; scope: "PRODUCT" | "CATEGORY" | "BILL"; discountType: "PERCENT" | "FIXED"; value: string;
  productId: string | null; categoryId: string | null; targetLabel: string; minPurchase: string | null;
  startsAt: string; endsAt: string; isActive: boolean; status: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "DISABLED";
};
type Dlg = { kind: "form"; row: Item | null } | { kind: "toggle"; row: Item } | null;

const SCOPE: Record<string, string> = { PRODUCT: "สินค้า", CATEGORY: "หมวดหมู่", BILL: "ทั้งบิล" };
const STATUS: Record<Item["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "กำลังใช้งาน", cls: "bg-green-100 text-green-800" },
  SCHEDULED: { label: "ยังไม่เริ่ม", cls: "bg-blue-100 text-blue-800" },
  EXPIRED: { label: "หมดอายุ", cls: "bg-slate-200 text-slate-700" },
  DISABLED: { label: "ปิดใช้งาน", cls: "bg-slate-200 text-slate-700" },
};
const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const discountLabel = (p: Item) => (p.discountType === "PERCENT" ? `${Number(p.value)}%` : p.scope === "BILL" ? formatMoney(p.value) : `${formatMoney(p.value)}/หน่วย`);
const fmtLocal = (iso: string) => formatDateTime(new Date(iso));

export function PromotionsManager({ items, products, categories, sortLinks }: { sortLinks: Record<"name" | "scope" | "target" | "discount" | "min" | "period" | "status", SortLink>; items: Item[]; products: { id: string; sku: string; name: string }[]; categories: { id: string; name: string }[] }) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const [scope, setScope] = useState<"PRODUCT" | "CATEGORY" | "BILL">("BILL");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const close = () => { setDlg(null); setError(null); };

  function open(row: Item | null) { setScope(row?.scope ?? "BILL"); setError(null); setDlg({ kind: "form", row }); }
  function submit(fn: () => Promise<ActionResult<unknown>>, okMsg: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(okMsg); close(); } else setError(res.error);
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">ส่วนลดรายการ: ต่อบรรทัดใช้ได้อันเดียว · ส่วนลดทั้งบิล: ใช้ได้อันเดียวและคิดจากยอดหลังลดรายการ · ส่วนลดบาทของสินค้า/หมวดคิดต่อหน่วย</p>
        <Button onClick={() => open(null)}><Plus /> เพิ่มโปรโมชั่น</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Percent} title="ยังไม่มีโปรโมชั่น" description="สร้างโปรโมชั่นแรกเพื่อให้ระบบลดราคาอัตโนมัติที่หน้า POS" action={<Button onClick={() => open(null)}><Plus /> เพิ่มโปรโมชั่น</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(2)]:hidden max-sm:[&_tr>:nth-child(3)]:hidden max-sm:[&_tr>:nth-child(5)]:hidden max-sm:[&_tr>:nth-child(6)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <SortHead label="ชื่อโปรโมชั่น" {...sortLinks.name} /><SortHead label="ประเภท" {...sortLinks.scope} /><SortHead label="เป้าหมาย" {...sortLinks.target} /><SortHead label="ส่วนลด" right {...sortLinks.discount} />
                <SortHead label="ขั้นต่ำ" right {...sortLinks.min} /><SortHead label="ช่วงเวลา" {...sortLinks.period} /><SortHead label="สถานะ" {...sortLinks.status} /><TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} className={p.status === "ACTIVE" ? "" : "opacity-70"}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{SCOPE[p.scope]}</TableCell>
                  <TableCell className="max-w-48 truncate" title={p.targetLabel}>{p.targetLabel}</TableCell>
                  <TableCell className="text-right tabular-nums">{discountLabel(p)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.minPurchase ? formatMoney(p.minPurchase) : "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{fmtLocal(p.startsAt)}<br />ถึง {fmtLocal(p.endsAt)}</TableCell>
                  <TableCell><Badge className={STATUS[p.status].cls}>{STATUS[p.status].label}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="แก้ไข" onClick={() => open(p)}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title={p.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} onClick={() => setDlg({ kind: "toggle", row: p })}>{p.isActive ? <PowerOff /> : <Power />}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dlg?.kind === "form"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-xl">
          {dlg?.kind === "form" && (
            <form
              key={dlg.row?.id ?? "new"}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => String(f.get(k) ?? "");
                const data = { name: v("name"), scope: v("scope"), discountType: v("discountType"), value: v("value"), productId: v("productId"), categoryId: v("categoryId"), minPurchase: v("minPurchase"), startsAt: v("startsAt"), endsAt: v("endsAt") };
                const row = dlg.row;
                submit(() => (row ? updatePromotionAction({ id: row.id, ...data }) : createPromotionAction(data)), row ? "บันทึกแล้ว" : "เพิ่มโปรโมชั่นแล้ว");
              }}
            >
              <DialogHeader>
                <DialogTitle>{dlg.row ? "แก้ไขโปรโมชั่น" : "เพิ่มโปรโมชั่น"}</DialogTitle>
                <DialogDescription>เวลาทั้งหมดเป็นเวลาไทย; บิลที่ขายไปแล้วไม่ถูกเปลี่ยนแปลง</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-2"><Label htmlFor="name">ชื่อโปรโมชั่น</Label><Input id="name" name="name" required maxLength={100} defaultValue={dlg.row?.name ?? ""} autoFocus /></div>
                <div className="space-y-2">
                  <Label htmlFor="scope">ใช้กับ</Label>
                  <select id="scope" name="scope" className={selectClass} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                    <option value="BILL">ทั้งบิล</option><option value="PRODUCT">สินค้า</option><option value="CATEGORY">หมวดหมู่</option>
                  </select>
                </div>
                <div className="space-y-2">
                  {scope === "PRODUCT" && (<><Label htmlFor="productId">สินค้า</Label><select id="productId" name="productId" required className={selectClass} defaultValue={dlg.row?.productId ?? ""}><option value="" disabled>เลือกสินค้า</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></>)}
                  {scope === "CATEGORY" && (<><Label htmlFor="categoryId">หมวดหมู่</Label><select id="categoryId" name="categoryId" required className={selectClass} defaultValue={dlg.row?.categoryId ?? ""}><option value="" disabled>เลือกหมวดหมู่</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></>)}
                  {scope === "BILL" && (<><Label htmlFor="minPurchase">ยอดซื้อขั้นต่ำ (บาท, ไม่บังคับ)</Label><Input id="minPurchase" name="minPurchase" inputMode="decimal" defaultValue={dlg.row?.minPurchase ?? ""} /></>)}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discountType">ประเภทส่วนลด</Label>
                  <select id="discountType" name="discountType" className={selectClass} defaultValue={dlg.row?.discountType ?? "PERCENT"}>
                    <option value="PERCENT">เปอร์เซ็นต์ (%)</option><option value="FIXED">จำนวนเงิน (บาท){scope !== "BILL" ? " ต่อหน่วย" : ""}</option>
                  </select>
                </div>
                <div className="space-y-2"><Label htmlFor="value">ส่วนลด</Label><Input id="value" name="value" required inputMode="decimal" defaultValue={dlg.row?.value ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="startsAt">เริ่ม</Label><Input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={dlg.row ? toBangkokInput(dlg.row.startsAt) : toBangkokInput(new Date().toISOString())} /></div>
                <div className="space-y-2"><Label htmlFor="endsAt">สิ้นสุด</Label><Input id="endsAt" name="endsAt" type="datetime-local" required defaultValue={dlg.row ? toBangkokInput(dlg.row.endsAt) : ""} /></div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={close}>ยกเลิก</Button><Button type="submit" disabled={pending}>บันทึก</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={dlg?.kind === "toggle"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          {dlg?.kind === "toggle" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dlg.row.isActive ? "ปิดใช้งานโปรโมชั่น?" : "เปิดใช้งานโปรโมชั่น?"}</AlertDialogTitle>
                <AlertDialogDescription>{dlg.row.isActive ? `“${dlg.row.name}” จะไม่ถูกนำไปคิดราคาในบิลถัดไป บิลที่ขายแล้วไม่เปลี่ยน` : `“${dlg.row.name}” จะใช้คิดราคาเมื่ออยู่ในช่วงเวลา`}</AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); submit(() => setPromotionActiveAction({ id: dlg.row.id, isActive: !dlg.row.isActive }), dlg.row.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว"); }}>ยืนยัน</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
