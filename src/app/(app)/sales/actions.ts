"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guard";
import { runAction } from "@/server/action";
import { resolveReviewSchema } from "@/lib/validators/checkout";
import { previewReturnSchema, returnSaleSchema } from "@/lib/validators/return";
import { resolveReviewSale } from "@/server/services/payments";
import { previewReturn, returnSale } from "@/server/services/returns";
import { syncNotifications } from "@/server/services/notifications";

export async function resolveReviewAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN"]);
    await resolveReviewSale(actor, resolveReviewSchema.parse(input));
    revalidatePath("/sales", "layout");
    revalidatePath("/inventory", "layout");
  });
}

// คืนสินค้า/ยกเลิกบิล = ADMIN หรือ OWNER (เงินออก + กระทบสต็อก/แต้ม) แคชเชียร์ทำไม่ได้ — ตรวจฝั่งเซิร์ฟเวอร์ทุกครั้ง
export async function previewReturnAction(input: unknown) {
  return runAction(async () => {
    await requireAction(["ADMIN", "OWNER"]);
    return previewReturn(previewReturnSchema.parse(input));
  });
}

export async function returnSaleAction(input: unknown) {
  return runAction(async () => {
    const actor = await requireAction(["ADMIN", "OWNER"]);
    const r = await returnSale(actor, returnSaleSchema.parse(input));
    if (!r.replayed) {
      after(async () => { try { await syncNotifications(); } catch (e) { console.error("[notifications sync]", e); } });
      revalidatePath("/sales", "layout");
      revalidatePath("/inventory", "layout");
      revalidatePath("/members", "layout");
    }
    return { returnNo: r.returnNo, refundTotal: r.refundTotal, pointsReversed: r.pointsReversed, saleStatus: r.saleStatus };
  });
}
