import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { listPromotions } from "@/server/services/promotions";
import { PromotionsManager } from "./promotions-manager";

export default async function PromotionsPage() {
  await requirePage(["ADMIN"]);
  const data = await listPromotions();
  return (
    <>
      <PageHeader title="โปรโมชั่น" description="ส่วนลดรายสินค้า/หมวดหมู่ และส่วนลดทั้งบิล — ระบบเลือกอันที่ลดมากที่สุดอันเดียวต่อรายการ (ไม่ซ้อนกัน)" />
      <PromotionsManager items={data.items} products={data.products} categories={data.categories} />
    </>
  );
}
