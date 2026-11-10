"use client";

import { useState, useTransition } from "react";
import { KeyRound, Pencil, Plus, UserCheck, UserX, Users } from "lucide-react";
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
import type { ActionResult } from "@/lib/result";
import { createUserAction, resetPasswordAction, setUserActiveAction, updateUserAction } from "./actions";

type Role = "ADMIN" | "CASHIER";
type UserRow = { id: string; email: string; name: string; role: Role; isActive: boolean; createdAt: string };

const ROLE_LABEL: Record<Role, string> = { ADMIN: "ผู้ดูแลระบบ", CASHIER: "แคชเชียร์" };
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Dlg = { kind: "create" } | { kind: "edit"; user: UserRow } | { kind: "password"; user: UserRow } | { kind: "toggle"; user: UserRow } | null;

export function UsersManager({ users, meId, sortLinks }: { users: UserRow[]; meId: string; sortLinks: Record<"name" | "email" | "role" | "status", SortLink> }) {
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
        <Button onClick={() => setDlg({ kind: "create" })}><Plus /> เพิ่มผู้ใช้</Button>
      </div>

      {users.length === 0 ? (
        <EmptyState icon={Users} title="ยังไม่มีผู้ใช้" />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <SortHead label="ชื่อ" {...sortLinks.name} />
                <SortHead label="อีเมล" {...sortLinks.email} />
                <SortHead label="สิทธิ์" {...sortLinks.role} />
                <SortHead label="สถานะ" {...sortLinks.status} />
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}{u.id === meId && <span className="ml-2 text-xs text-muted-foreground">(คุณ)</span>}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{ROLE_LABEL[u.role]}</Badge></TableCell>
                  <TableCell><Badge variant={u.isActive ? "outline" : "destructive"}>{u.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="แก้ไข" onClick={() => setDlg({ kind: "edit", user: u })}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title="รีเซ็ตรหัสผ่าน" onClick={() => setDlg({ kind: "password", user: u })}><KeyRound /></Button>
                      {u.id !== meId && (
                        <Button size="icon-sm" variant="ghost" title={u.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} onClick={() => setDlg({ kind: "toggle", user: u })}>
                          {u.isActive ? <UserX /> : <UserCheck />}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* สร้าง / แก้ไข */}
      <Dialog open={dlg?.kind === "create" || dlg?.kind === "edit"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {(dlg?.kind === "create" || dlg?.kind === "edit") && (
            <form
              key={dlg.kind === "edit" ? dlg.user.id : "create"}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const name = String(f.get("name") ?? "");
                const role = String(f.get("role") ?? "CASHIER");
                if (dlg.kind === "create") {
                  submit(() => createUserAction({ name, role, email: String(f.get("email") ?? ""), password: String(f.get("password") ?? "") }), "เพิ่มผู้ใช้แล้ว");
                } else {
                  submit(() => updateUserAction({ id: dlg.user.id, name, role }), "บันทึกแล้ว");
                }
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>{dlg.kind === "create" ? "เพิ่มผู้ใช้" : "แก้ไขผู้ใช้"}</DialogTitle>
                <DialogDescription>{dlg.kind === "edit" ? dlg.user.email : "กำหนดอีเมลและรหัสผ่านเริ่มต้น"}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2"><Label htmlFor="name">ชื่อ</Label><Input id="name" name="name" required defaultValue={dlg.kind === "edit" ? dlg.user.name : ""} /></div>
              {dlg.kind === "create" && (
                <>
                  <div className="space-y-2"><Label htmlFor="email">อีเมล</Label><Input id="email" name="email" type="email" required /></div>
                  <div className="space-y-2"><Label htmlFor="password">รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)</Label><Input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="role">สิทธิ์</Label>
                <select id="role" name="role" className={selectClass} defaultValue={dlg.kind === "edit" ? dlg.user.role : "CASHIER"} disabled={dlg.kind === "edit" && dlg.user.id === meId}>
                  <option value="CASHIER">แคชเชียร์</option>
                  <option value="ADMIN">ผู้ดูแลระบบ</option>
                </select>
                {dlg.kind === "edit" && dlg.user.id === meId && <input type="hidden" name="role" value={dlg.user.role} />}
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

      {/* รีเซ็ตรหัสผ่าน */}
      <Dialog open={dlg?.kind === "password"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {dlg?.kind === "password" && (
            <form
              key={dlg.user.id}
              onSubmit={(e) => {
                e.preventDefault();
                const password = String(new FormData(e.currentTarget).get("password") ?? "");
                submit(() => resetPasswordAction({ id: dlg.user.id, password }), "รีเซ็ตรหัสผ่านแล้ว");
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>รีเซ็ตรหัสผ่าน</DialogTitle>
                <DialogDescription>{dlg.user.name} ({dlg.user.email})</DialogDescription>
              </DialogHeader>
              <div className="space-y-2"><Label htmlFor="pw">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</Label><Input id="pw" name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>ยกเลิก</Button>
                <Button type="submit" disabled={pending}>ตั้งรหัสผ่าน</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ปิด/เปิดใช้งาน */}
      <AlertDialog open={dlg?.kind === "toggle"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          {dlg?.kind === "toggle" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dlg.user.isActive ? "ปิดใช้งานผู้ใช้?" : "เปิดใช้งานผู้ใช้?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {dlg.user.isActive ? `${dlg.user.name} จะเข้าสู่ระบบไม่ได้ทันที ประวัติการขายยังอยู่ครบ` : `${dlg.user.name} จะเข้าสู่ระบบได้อีกครั้ง`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault();
                    submit(() => setUserActiveAction({ id: dlg.user.id, isActive: !dlg.user.isActive }), dlg.user.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว");
                  }}
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
