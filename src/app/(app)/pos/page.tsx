import { PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { listPosProducts } from "@/server/services/pos";
import { describePaymentConfig } from "@/server/payments/config";
import { PosTerminal } from "./pos-terminal";

export default async function PosPage() {
  await requirePage(["ADMIN", "CASHIER"]);
  const products = await listPosProducts();
  return (
    <>
      <PageHeader title="ขายหน้าร้าน (POS)" description="สแกนหรือพิมพ์ SKU/บาร์โค้ดแล้วกด Enter · F2 = ไปที่ช่องค้นหา" />
      {products.length === 0 ? (
        <EmptyState icon={PackageSearch} title="ยังไม่มีสินค้าที่เปิดขาย" description="ให้ผู้ดูแลระบบเพิ่มสินค้าและรับสต็อกเข้าก่อน" />
      ) : (
        <PosTerminal products={products} payment={describePaymentConfig()} />
      )}
    </>
  );
}
