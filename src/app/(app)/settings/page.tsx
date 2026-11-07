import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/server/auth/guard";
import { describePaymentConfig } from "@/server/payments/config";
import { getSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requirePage(["ADMIN"]);
  const [settings, pay] = await Promise.all([getSettings(), Promise.resolve(describePaymentConfig())]);
  return (
    <>
      <PageHeader title="ตั้งค่า" description="ข้อมูลร้านบนใบเสร็จ อัตราแต้มสะสม และค่าการแจ้งเตือน/QR — การเปลี่ยนแปลงมีผลกับบิลถัดไป และถูกบันทึกใน Audit Log" />
      <SettingsForm initial={settings} payment={pay} />
    </>
  );
}
