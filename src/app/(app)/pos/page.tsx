import { Construction } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";

export default async function PosPage() {
  await requirePage(["ADMIN", "CASHIER"]);
  return (
    <>
      <PageHeader title="ขายหน้าร้าน (POS)" />
      <EmptyState icon={Construction} title="ยังไม่พร้อมใช้งาน" description="หน้านี้อยู่ระหว่างการพัฒนา (วันที่ 5 ตามแผน)" />
    </>
  );
}
