import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { listCategories } from "@/server/services/categories";
import { CategoriesManager } from "./categories-manager";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePage(["ADMIN"]);
  const { q } = await searchParams;
  const categories = await listCategories(q);
  return (
    <>
      <PageHeader title="หมวดหมู่สินค้า" description="จัดกลุ่มสินค้าเพื่อค้นหาและทำโปรโมชั่น" />
      <form className="mb-4 flex max-w-sm gap-2" role="search">
        <Input name="q" defaultValue={q ?? ""} placeholder="ค้นหาหมวดหมู่" aria-label="ค้นหาหมวดหมู่" />
        <Button type="submit" variant="outline"><Search /> ค้นหา</Button>
      </form>
      <CategoriesManager
        searching={!!q?.trim()}
        categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description, productCount: c._count.products }))}
      />
    </>
  );
}
