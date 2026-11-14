import Link from "next/link";
import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { auditLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/date";
import { requirePage } from "@/server/auth/guard";
import { listAuditLogs } from "@/server/services/audit-log";

const selectClass = "h-11 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
type SP = { action?: string; user?: string; from?: string; to?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const action = z.string().max(60).safeParse(sp.action).data || undefined;
  const userId = z.string().uuid().safeParse(sp.user).data;
  const from = date.safeParse(sp.from).data;
  const to = date.safeParse(sp.to).data;
  const page = z.coerce.number().int().min(1).catch(1).parse(sp.page);
  const data = await listAuditLogs({ action, userId, from, to, page });

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (action) u.set("action", action);
    if (userId) u.set("user", userId);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };
  const filtered = !!(action || userId || from || to);

  return (
    <>
      <PageHeader eyebrow="Audit log" title="บันทึกการใช้งาน (Audit Log)" description={`เหตุการณ์สำคัญที่ระบบบันทึกไว้ ${data.total.toLocaleString("th-TH")} รายการ — อ่านอย่างเดียว แก้ไขหรือลบไม่ได้`} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <select name="action" defaultValue={action ?? ""} aria-label="เหตุการณ์" className={selectClass}>
          <option value="">ทุกเหตุการณ์</option>
          {data.actions.map((a) => <option key={a} value={a}>{auditLabel(a)}</option>)}
        </select>
        <select name="user" defaultValue={userId ?? ""} aria-label="ผู้ทำรายการ" className={selectClass}>
          <option value="">ทุกคน</option>
          {data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <Input name="from" type="date" defaultValue={from ?? ""} aria-label="ตั้งแต่วันที่" className="w-40" />
        <Input name="to" type="date" defaultValue={to ?? ""} aria-label="ถึงวันที่" className="w-40" />
        <Button type="submit" variant="outline"><Search /> กรอง</Button>
        {filtered && <Link href="/audit" className="text-sm text-muted-foreground hover:underline">ล้างตัวกรอง</Link>}
      </form>

      {data.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={filtered ? "ไม่พบเหตุการณ์ตามเงื่อนไข" : "ยังไม่มีบันทึก"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow className="bg-lavender-50 hover:bg-lavender-50"><TableHead>เวลา</TableHead><TableHead>ผู้ทำรายการ</TableHead><TableHead>เหตุการณ์</TableHead><TableHead>ข้อมูลที่เกี่ยวข้อง</TableHead><TableHead>รายละเอียด</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(new Date(r.createdAt))}</TableCell>
                  <TableCell>{r.user ?? <span className="text-muted-foreground">ไม่ระบุ/ระบบ</span>}</TableCell>
                  <TableCell><Badge variant={r.action === "LOGIN_FAILED" ? "destructive" : "outline"}>{auditLabel(r.action)}</Badge></TableCell>
                  <TableCell className="text-sm"><span className="text-muted-foreground">{r.entity}</span>{r.entityId && <div className="font-mono">{r.entityId.slice(0, 8)}…</div>}</TableCell>
                  <TableCell className="max-w-md text-sm">
                    {r.before || r.after ? (
                      <details>
                        <summary className="cursor-pointer text-primary">ดูรายละเอียด</summary>
                        {r.before && <><p className="mt-1 font-medium">ก่อน</p><pre className="overflow-x-auto rounded bg-muted p-2">{r.before}</pre></>}
                        {r.after && <><p className="mt-1 font-medium">หลัง</p><pre className="overflow-x-auto rounded bg-muted p-2">{r.after}</pre></>}
                      </details>
                    ) : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-end gap-3 text-sm" aria-label="เปลี่ยนหน้า">
          <span className="text-muted-foreground">หน้า {data.page} / {data.pageCount}</span>
          {data.page > 1 && <Link href={href(data.page - 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted"><ChevronLeft className="size-4" /> ก่อนหน้า</Link>}
          {data.page < data.pageCount && <Link href={href(data.page + 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted">ถัดไป <ChevronRight className="size-4" /></Link>}
        </nav>
      )}
    </>
  );
}
