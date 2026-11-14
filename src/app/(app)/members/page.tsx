import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { parseSort, sortLinks, type SortState } from "@/lib/sort";
import { MEMBER_SORT_KEYS, listMembers, type MemberSortKey } from "@/server/services/members";
import { MembersManager } from "./members-manager";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }> }) {
  await requirePage(["ADMIN", "OWNER"]);
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const page = z.coerce.number().int().min(1).catch(1).parse(sp.page);
  // ค่าเริ่มต้น = สถานะ (ใช้งานก่อน) แล้วตามรหัส — เท่ากับลำดับเดิมของหน้านี้
  const sort = parseSort(MEMBER_SORT_KEYS, sp, { key: "status", dir: "asc" });
  const data = await listMembers({ q, page, sort });
  const url = (p: number, st: SortState<MemberSortKey>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (!(st.key === "status" && st.dir === "asc")) { u.set("sort", st.key); u.set("dir", st.dir); }
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/members${s ? `?${s}` : ""}`;
  };
  const href = (p: number) => url(p, sort);
  const links = sortLinks(MEMBER_SORT_KEYS, sort, (st) => url(1, st), ["points", "spent"]);

  return (
    <>
      <PageHeader eyebrow="Members" title="สมาชิก" description={`ทั้งหมด ${data.total.toLocaleString("th-TH")} คน · ได้แต้มตามยอดซื้อสุทธิ (ตั้งอัตราที่การตั้งค่า points_per_baht)`} />
      <form className="mb-4 flex max-w-lg gap-2" role="search">
        <input type="hidden" name="sort" value={sort.key} />
        <input type="hidden" name="dir" value={sort.dir} />
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหาชื่อ / เบอร์โทร / รหัสสมาชิก" aria-label="ค้นหาสมาชิก" />
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
      </form>
      <MembersManager items={data.items} filtered={!!q} sortLinks={links} />
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
