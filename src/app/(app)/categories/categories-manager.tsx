"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import type { ActionResult } from "@/lib/result";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";

type Row = { id: string; name: string; description: string | null; productCount: number };
type Dlg = { kind: "form"; row: Row | null } | { kind: "delete"; row: Row } | null;

export function CategoriesManager({ categories, searching }: { categories: Row[]; searching: boolean }) {
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
        <Button onClick={() => setDlg({ kind: "form", row: null })}><Plus /> เพิ่มหมวดหมู่</Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={searching ? "ไม่พบหมวดหมู่ที่ค้นหา" : "ยังไม่มีหมวดหมู่"}
          description={searching ? undefined : "เริ่มจากเพิ่มหมวดหมู่แรกของร้าน"}
          action={searching ? undefined : <Button onClick={() => setDlg({ kind: "form", row: null })}><Plus /> เพิ่มหมวดหมู่</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(2)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>ชื่อหมวดหมู่</TableHead>
                <TableHead>คำอธิบาย</TableHead>
                <TableHead className="text-right">จำนวนสินค้า</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.description ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.productCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="แก้ไข" onClick={() => setDlg({ kind: "form", row: c })}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title="ลบ" onClick={() => setDlg({ kind: "delete", row: c })}><Trash2 /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dlg?.kind === "form"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {dlg?.kind === "form" && (
            <form
              key={dlg.row?.id ?? "new"}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const data = { name: String(f.get("name") ?? ""), description: String(f.get("description") ?? "") };
                const row = dlg.row;
                submit(() => (row ? updateCategoryAction({ id: row.id, ...data }) : createCategoryAction(data)), row ? "บันทึกแล้ว" : "เพิ่มหมวดหมู่แล้ว");
              }}
            >
              <DialogHeader><DialogTitle>{dlg.row ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่"}</DialogTitle></DialogHeader>
              <div className="space-y-2"><Label htmlFor="name">ชื่อหมวดหมู่</Label><Input id="name" name="name" required maxLength={60} defaultValue={dlg.row?.name ?? ""} autoFocus /></div>
              <div className="space-y-2"><Label htmlFor="description">คำอธิบาย (ไม่บังคับ)</Label><Input id="description" name="description" maxLength={200} defaultValue={dlg.row?.description ?? ""} /></div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>ยกเลิก</Button>
                <Button type="submit" disabled={pending}>บันทึก</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={dlg?.kind === "delete"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          {dlg?.kind === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>ลบหมวดหมู่ “{dlg.row.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {dlg.row.productCount > 0 ? `หมวดนี้มีสินค้า ${dlg.row.productCount} รายการ จึงลบไม่ได้ ต้องย้ายสินค้าออกก่อน` : "การลบไม่สามารถย้อนกลับได้"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => { e.preventDefault(); submit(() => deleteCategoryAction({ id: dlg.row.id }), "ลบหมวดหมู่แล้ว"); }}
                >
                  ลบ
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
