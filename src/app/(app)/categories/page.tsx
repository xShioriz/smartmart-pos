import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { parseSort, sortLinks, sortRows } from "@/lib/sort";
import { listCategories } from "@/server/services/categories";
import { CategoriesManager } from "./categories-manager";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; dir?: string }> }) {
  await requirePage(["ADMIN", "OWNER"]);
  const sp = await searchParams;
  const q = sp.q;
  const KEYS = ["name", "description", "count"] as const;
  const sort = parseSort(KEYS, sp, { key: "name", dir: "asc" });
  const rows = (await listCategories(q)).map((c) => ({ id: c.id, name: c.name, description: c.description, productCount: c._count.products }));
  const categories = sortRows(rows, sort, { name: (r) => r.name, description: (r) => r.description, count: (r) => r.productCount }, (r) => r.name);
  const links = sortLinks(KEYS, sort, (s) => `/categories?${new URLSearchParams({ ...(q?.trim() ? { q: q.trim() } : {}), sort: s.key, dir: s.dir })}`, ["count"]);
  return (
    <>
      <PageHeader eyebrow="Categories" title="หมวดหมู่สินค้า" description="จัดกลุ่มสินค้าเพื่อค้นหาและทำโปรโมชั่น" />
      <form className="mb-4 flex max-w-sm gap-2" role="search">
        <input type="hidden" name="sort" value={sort.key} />
        <input type="hidden" name="dir" value={sort.dir} />
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหาหมวดหมู่" aria-label="ค้นหาหมวดหมู่" />
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
      </form>
      <CategoriesManager
        searching={!!q?.trim()}
        categories={categories}
        sortLinks={links}
      />
    </>
  );
}
