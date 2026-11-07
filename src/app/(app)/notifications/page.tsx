import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { listNotifications, syncNotifications } from "@/server/services/notifications";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  await requirePage(["ADMIN"]);
  await syncNotifications(); // สต็อก/หมดอายุคำนวณใหม่ทุกครั้งที่เปิดหน้า (ไม่มี cron)
  const items = await listNotifications(false);
  return (
    <>
      <PageHeader title="การแจ้งเตือน" description="สินค้าใกล้หมด/หมด, ใกล้หมดอายุ/หมดอายุ และรายการชำระเงินที่ต้องตรวจสอบ — รายการจะหายเองเมื่อแก้ปัญหาแล้ว" />
      <NotificationList items={items} />
    </>
  );
}
