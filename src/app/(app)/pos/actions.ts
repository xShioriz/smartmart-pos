"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { checkoutCashSchema } from "@/lib/validators/checkout";
import { checkoutCash } from "@/server/services/checkout";
import { syncNotifications } from "@/server/services/notifications";

export async function checkoutCashAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "CASHIER"]);
    const result = await checkoutCash(actor, checkoutCashSchema.parse(input));
    if (!result.replayed) {
      // หลังตอบกลับ: ซิงก์แจ้งเตือนสต็อก (ล้มเหลวแล้วไม่กระทบการขาย) และรีเฟรชหน้าที่เกี่ยวข้อง
      after(async () => {
        try { await syncNotifications(); } catch (e) { console.error("[notifications sync]", e); }
      });
      revalidatePath("/inventory", "layout");
      revalidatePath("/sales");
    }
    return { saleId: result.saleId, receiptNo: result.receiptNo, change: result.change };
  });
}
