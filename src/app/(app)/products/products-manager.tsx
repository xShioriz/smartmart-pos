"use client";

import { useState, useTransition } from "react";
import { Package, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { SortHead } from "@/components/shared/sort-head";
import type { SortLink } from "@/lib/sort";
import type { ActionResult } from "@/lib/result";
import { formatMoney } from "@/lib/money";
import { createProductAction, setProductActiveAction, updateProductAction } from "./actions";

type Row = {
  id: string; sku: string; barcode: string | null; name: string; categoryId: string; categoryName: string;
  costPrice: string; price: string; unit: string; stockQty: number; minStock: number; isActive: boolean;
};
type Dlg = { kind: "form"; row: Row | null } | { kind: "toggle"; row: Row } | null;

const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function StockBadge({ qty, min }: { qty: number; min: number }) {
  if (qty <= 0) return <Badge variant="destructive">หมด</Badge>;
  if (qty <= min) return <Badge variant="warning">ใกล้หมด</Badge>;
  return <span className="tabular-nums">{qty.toLocaleString("th-TH")}</span>;
}

export function ProductsManager({ items, categories, filtered, noCategories, sortLinks }: { items: Row[]; categories: { id: string; name: string }[]; filtered: boolean; noCategories: boolean; sortLinks: Record<"sku" | "name" | "category" | "cost" | "price" | "stock" | "status", SortLink> }) {
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
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDlg({ kind: "form", row: null })} disabled={noCategories} title={noCategories ? "ต้องมีหมวดหมู่ก่อน" : undefined}><Plus /> เพิ่มสินค้า</Button>
      </div>

      {noCategories && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">ยังไม่มีหมวดหมู่ ต้องสร้างหมวดหมู่ก่อนจึงจะเพิ่มสินค้าได้</p>}

      {items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filtered ? "ไม่พบสินค้าตามเงื่อนไข" : "ยังไม่มีสินค้า"}
          description={filtered ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "เริ่มจากเพิ่มสินค้าแรกของร้าน"}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(3)]:hidden max-sm:[&_tr>:nth-child(4)]:hidden max-sm:[&_tr>:nth-child(7)]:hidden max-sm:[&_tr>:nth-child(1)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                <SortHead label="SKU" {...sortLinks.sku} />
                <SortHead label="ชื่อสินค้า" {...sortLinks.name} />
                <SortHead label="หมวดหมู่" {...sortLinks.category} />
                <SortHead label="ราคาทุน" right {...sortLinks.cost} />
                <SortHead label="ราคาขาย" right {...sortLinks.price} />
                <SortHead label="คงเหลือ" right {...sortLinks.stock} />
                <SortHead label="สถานะ" {...sortLinks.status} />
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} className={p.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    {p.barcode && <div className="text-sm text-muted-foreground">{p.barcode}</div>}
                  </TableCell>
                  <TableCell>{p.categoryName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.costPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.price)}</TableCell>
                  <TableCell className="text-right"><StockBadge qty={p.stockQty} min={p.minStock} /> <span className="text-sm text-muted-foreground">{p.unit}</span></TableCell>
                  <TableCell><Badge variant={p.isActive ? "outline" : "secondary"}>{p.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="แก้ไข" onClick={() => setDlg({ kind: "form", row: p })}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title={p.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} onClick={() => setDlg({ kind: "toggle", row: p })}>
                        {p.isActive ? <PowerOff /> : <Power />}
                      </Button>
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
                const core = { sku: v("sku"), barcode: v("barcode"), name: v("name"), categoryId: v("categoryId"), costPrice: v("costPrice"), price: v("price"), unit: v("unit"), minStock: v("minStock") };
                const row = dlg.row;
                submit(
                  () => (row ? updateProductAction({ id: row.id, ...core }) : createProductAction({ ...core, initialQty: v("initialQty") || "0", initialExpiry: v("initialExpiry") })),
                  row ? "บันทึกแล้ว" : "เพิ่มสินค้าแล้ว",
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>{dlg.row ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</DialogTitle>
                <DialogDescription>{dlg.row ? `คงเหลือ ${dlg.row.stockQty} ${dlg.row.unit} — ปรับสต็อกได้ที่หน้าคลังสินค้า` : "สต็อกเริ่มต้นจะถูกบันทึกเป็นล็อตแรกพร้อมประวัติการเคลื่อนไหว"}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label htmlFor="sku">SKU</Label><Input id="sku" name="sku" required maxLength={40} defaultValue={dlg.row?.sku ?? ""} autoFocus /></div>
                <div className="space-y-2"><Label htmlFor="barcode">บาร์โค้ด (ไม่บังคับ)</Label><Input id="barcode" name="barcode" maxLength={50} defaultValue={dlg.row?.barcode ?? ""} /></div>
                <div className="col-span-2 space-y-2"><Label htmlFor="name">ชื่อสินค้า</Label><Input id="name" name="name" required maxLength={120} defaultValue={dlg.row?.name ?? ""} /></div>
                <div className="space-y-2">
                  <Label htmlFor="categoryId">หมวดหมู่</Label>
                  <select id="categoryId" name="categoryId" required className={selectClass} defaultValue={dlg.row?.categoryId ?? ""}>
                    <option value="" disabled>เลือกหมวดหมู่</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2"><Label htmlFor="unit">หน่วยนับ</Label><Input id="unit" name="unit" required maxLength={20} defaultValue={dlg.row?.unit ?? "ชิ้น"} /></div>
                <div className="space-y-2"><Label htmlFor="costPrice">ราคาทุน (บาท)</Label><Input id="costPrice" name="costPrice" required inputMode="decimal" defaultValue={dlg.row?.costPrice ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="price">ราคาขาย (บาท)</Label><Input id="price" name="price" required inputMode="decimal" defaultValue={dlg.row?.price ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="minStock">จำนวนขั้นต่ำ (แจ้งใกล้หมด)</Label><Input id="minStock" name="minStock" required inputMode="numeric" defaultValue={dlg.row?.minStock ?? 0} /></div>
                {!dlg.row && (
                  <>
                    <div className="space-y-2"><Label htmlFor="initialQty">สต็อกเริ่มต้น</Label><Input id="initialQty" name="initialQty" inputMode="numeric" defaultValue={0} /></div>
                    <div className="col-span-2 space-y-2"><Label htmlFor="initialExpiry">วันหมดอายุของล็อตแรก (ไม่บังคับ)</Label><Input id="initialExpiry" name="initialExpiry" type="date" /></div>
                  </>
                )}
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>ยกเลิก</Button>
                <Button type="submit" disabled={pending}>บันทึก</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={dlg?.kind === "toggle"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          {dlg?.kind === "toggle" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dlg.row.isActive ? "ปิดใช้งานสินค้า?" : "เปิดใช้งานสินค้า?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {dlg.row.isActive ? `“${dlg.row.name}” จะไม่แสดงในหน้าขาย แต่ประวัติการขายเดิมยังอยู่ครบ` : `“${dlg.row.name}” จะกลับมาขายได้`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => { e.preventDefault(); submit(() => setProductActiveAction({ id: dlg.row.id, isActive: !dlg.row.isActive }), dlg.row.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว"); }}
                >
                  ยืนยัน
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
