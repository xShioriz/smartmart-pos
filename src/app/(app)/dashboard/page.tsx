import { Construction } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";

export default async function DashboardPage() {
  await requirePage(["ADMIN"]);
  return (
    <>
      <PageHeader title="แดชบอร์ด" />
      <EmptyState icon={Construction} title="ยังไม่พร้อมใช้งาน" description="หน้านี้อยู่ระหว่างการพัฒนา (วันที่ 8 ตามแผน)" />
    </>
  );
}
