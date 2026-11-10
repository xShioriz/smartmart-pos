import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { parseSort, sortLinks, sortRows } from "@/lib/sort";
import { listPromotions } from "@/server/services/promotions";
import { PromotionsManager } from "./promotions-manager";

const KEYS = ["name", "scope", "target", "discount", "min", "period", "status"] as const;
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, SCHEDULED: 1, EXPIRED: 2, DISABLED: 3 };

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<{ sort?: string; dir?: string }> }) {
  await requirePage(["ADMIN"]);
  const sp = await searchParams;
  const sort = parseSort(KEYS, sp, { key: "status", dir: "asc" });
  const data = await listPromotions();
  const items = sortRows(data.items, sort, {
    name: (p) => p.name, scope: (p) => p.scope, target: (p) => p.targetLabel, discount: (p) => Number(p.value),
    min: (p) => (p.minPurchase === null ? null : Number(p.minPurchase)), period: (p) => p.startsAt, status: (p) => STATUS_RANK[p.status] ?? 9,
  }, (p) => p.name);
  const links = sortLinks(KEYS, sort, (s) => `/promotions?sort=${s.key}&dir=${s.dir}`, ["discount", "min", "period"]);
  return (
    <>
      <PageHeader title="โปรโมชั่น" description="ส่วนลดรายสินค้า/หมวดหมู่ และส่วนลดทั้งบิล — ระบบเลือกอันที่ลดมากที่สุดอันเดียวต่อรายการ (ไม่ซ้อนกัน)" />
      <PromotionsManager items={items} sortLinks={links} products={data.products} categories={data.categories} />
    </>
  );
}
