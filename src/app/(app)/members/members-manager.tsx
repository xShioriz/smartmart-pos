"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Plus, UserCheck, UserRound, UserX } from "lucide-react";
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
import { formatMoney } from "@/lib/money";
import type { ActionResult } from "@/lib/result";
import { createMemberAction, setMemberActiveAction, updateMemberAction } from "./actions";

type Item = { id: string; code: string; name: string; phone: string; email: string | null; points: number; totalSpent: string; isActive: boolean };
type Dlg = { kind: "form"; row: Item | null } | { kind: "toggle"; row: Item } | null;

export function MembersManager({ items, filtered, sortLinks }: { items: Item[]; filtered: boolean; sortLinks: Record<"code" | "name" | "phone" | "points" | "spent" | "status", SortLink> }) {
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
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: "form", row: null })}><Plus /> เพิ่มสมาชิก</Button></div>

      {items.length === 0 ? (
        <EmptyState icon={UserRound} title={filtered ? "ไม่พบสมาชิกที่ค้นหา" : "ยังไม่มีสมาชิก"} description={filtered ? undefined : "เพิ่มสมาชิกเพื่อสะสมแต้มจากการซื้อ"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="max-sm:[&_tr>:nth-child(3)]:hidden max-sm:[&_tr>:nth-child(5)]:hidden max-sm:[&_tr>:nth-child(6)]:hidden max-sm:[&_:is(th,td)]:px-1.5 max-sm:[&_td]:whitespace-normal">
            <TableHeader>
              <TableRow className="bg-lavender-50 hover:bg-lavender-50">
                <SortHead label="รหัส" {...sortLinks.code} /><SortHead label="ชื่อ" {...sortLinks.name} /><SortHead label="เบอร์โทร" {...sortLinks.phone} />
                <SortHead label="แต้มคงเหลือ" right {...sortLinks.points} /><SortHead label="ยอดซื้อสะสม" right {...sortLinks.spent} /><SortHead label="สถานะ" {...sortLinks.status} /><TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id} className={m.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-mono text-xs">{m.code}</TableCell>
                  <TableCell><Link href={`/members/${m.id}`} className="font-medium hover:text-primary hover:underline">{m.name}</Link></TableCell>
                  <TableCell className="tabular-nums">{m.phone}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.points.toLocaleString("th-TH")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(m.totalSpent)}</TableCell>
                  <TableCell><Badge variant={m.isActive ? "outline" : "secondary"}>{m.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="แก้ไข" onClick={() => setDlg({ kind: "form", row: m })}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title={m.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} onClick={() => setDlg({ kind: "toggle", row: m })}>{m.isActive ? <UserX /> : <UserCheck />}</Button>
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
                const data = { name: String(f.get("name") ?? ""), phone: String(f.get("phone") ?? ""), email: String(f.get("email") ?? "") };
                const row = dlg.row;
                submit(() => (row ? updateMemberAction({ id: row.id, ...data }) : createMemberAction(data)), row ? "บันทึกแล้ว" : "เพิ่มสมาชิกแล้ว");
              }}
            >
              <DialogHeader>
                <DialogTitle>{dlg.row ? `แก้ไขสมาชิก ${dlg.row.code}` : "เพิ่มสมาชิก"}</DialogTitle>
                <DialogDescription>{dlg.row ? "แต้มและยอดซื้อสะสมแก้ไขเองไม่ได้ (เปลี่ยนตามการขายเท่านั้น)" : "ระบบออกรหัสสมาชิกให้อัตโนมัติ"}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2"><Label htmlFor="name">ชื่อ</Label><Input id="name" name="name" required maxLength={80} defaultValue={dlg.row?.name ?? ""} autoFocus /></div>
              <div className="space-y-2"><Label htmlFor="phone">เบอร์โทร (10 หลัก)</Label><Input id="phone" name="phone" required inputMode="tel" defaultValue={dlg.row?.phone ?? ""} /></div>
              <div className="space-y-2"><Label htmlFor="email">อีเมล (ไม่บังคับ)</Label><Input id="email" name="email" type="email" maxLength={120} defaultValue={dlg.row?.email ?? ""} /></div>
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
                <AlertDialogTitle>{dlg.row.isActive ? "ปิดใช้งานสมาชิก?" : "เปิดใช้งานสมาชิก?"}</AlertDialogTitle>
                <AlertDialogDescription>{dlg.row.isActive ? `${dlg.row.name} จะค้นหาที่หน้า POS ไม่เจอ แต้มและประวัติยังอยู่ครบ` : `${dlg.row.name} จะใช้สะสมแต้มได้อีกครั้ง`}</AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={(e) => { e.preventDefault(); submit(() => setMemberActiveAction({ id: dlg.row.id, isActive: !dlg.row.isActive }), dlg.row.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว"); }}>ยืนยัน</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
