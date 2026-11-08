import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { categoryOptions } from "@/server/services/categories";
import { parseSort, sortLinks, type SortState } from "@/lib/sort";
import { PRODUCT_SORT_KEYS, listProducts, type ProductSortKey } from "@/server/services/products";
import { ProductsManager } from "./products-manager";

const selectClass = "h-8 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type SP = { q?: string; category?: string; status?: string; page?: string; sort?: string; dir?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const categoryId = z.string().uuid().safeParse(sp.category).data;
  const status = z.enum(["all", "active", "inactive"]).catch("all").parse(sp.status);
  const page = z.coerce.number().int().min(1).catch(1).parse(sp.page);

  const sort = parseSort(PRODUCT_SORT_KEYS, sp, { key: "name", dir: "asc" });
  const [categories, data] = await Promise.all([categoryOptions(), listProducts({ q, categoryId, status, page, sort })]);

  const url = (p: number, s: SortState<ProductSortKey>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (categoryId) u.set("category", categoryId);
    if (status !== "all") u.set("status", status);
    if (!(s.key === "name" && s.dir === "asc")) { u.set("sort", s.key); u.set("dir", s.dir); }
    if (p > 1) u.set("page", String(p));
    const str = u.toString();
    return `/products${str ? `?${str}` : ""}`;
  };
  const href = (p: number) => url(p, sort);
  const sortLinkMap = sortLinks(PRODUCT_SORT_KEYS, sort, (s) => url(1, s), ["cost", "price", "stock"]); // เปลี่ยนเรียง = กลับหน้า 1

  return (
    <>
      <PageHeader title="สินค้า" description={`ทั้งหมด ${data.total.toLocaleString("th-TH")} รายการ`} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="sort" value={sort.key} />
        <input type="hidden" name="dir" value={sort.dir} />
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหา SKU / บาร์โค้ด / ชื่อ" aria-label="ค้นหาสินค้า" className="w-64" />
        <select name="category" defaultValue={categoryId ?? ""} aria-label="หมวดหมู่" className={selectClass}>
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} aria-label="สถานะ" className={selectClass}>
          <option value="all">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
      </form>

      <ProductsManager
        items={data.items}
        categories={categories}
        sortLinks={sortLinkMap}
        filtered={!!(q || categoryId || status !== "all")}
        noCategories={categories.length === 0}
      />

      {data.pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-end gap-3 text-sm" aria-label="เปลี่ยนหน้า">
          <span className="text-muted-foreground">หน้า {data.page} / {data.pageCount}</span>
          {data.page > 1 ? <Link href={href(data.page - 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted"><ChevronLeft className="size-4" /> ก่อนหน้า</Link> : null}
          {data.page < data.pageCount ? <Link href={href(data.page + 1)} className="inline-flex items-center rounded-lg border bg-card px-2 py-1 hover:bg-muted">ถัดไป <ChevronRight className="size-4" /></Link> : null}
        </nav>
      )}
    </>
  );
}
