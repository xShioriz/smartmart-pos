// การกระทำของผู้ดูแลต่อสต็อก (รับเข้า/ปรับยอด) = stock.ts + audit ใน transaction เดียว
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { D } from "@/lib/money";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { adjustBatch, receiveBatch, type AdjustMode } from "./stock";
import { syncNotifications } from "./notifications";

export async function receiveStock(
  actor: CurrentUser,
  input: { productId: string; qty: number; costPrice: string; expiryDate: string | null; batchNo: string | null; note: string | null },
) {
  const batch = await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, sku: true } });
    if (!product) throw new BusinessError("ไม่พบสินค้า");
    const b = await receiveBatch(tx, actor.id, {
      productId: input.productId, qty: input.qty, costPrice: D(input.costPrice), expiryDate: input.expiryDate,
      type: "RESTOCK", batchNo: input.batchNo, note: input.note ?? "รับสินค้าเข้า",
    });
    await audit(tx, {
      userId: actor.id, action: "STOCK_RECEIVE", entity: "Product", entityId: product.id,
      after: { sku: product.sku, batchNo: b.batchNo, qty: input.qty, costPrice: input.costPrice, expiryDate: input.expiryDate },
    });
    return b;
  });
  await syncNotifications();
  return { batchId: batch.id };
}

export async function adjustStock(actor: CurrentUser, input: { batchId: string; mode: AdjustMode; qty: number; reason: string }) {
  const r = await db.$transaction(async (tx) => {
    const res = await adjustBatch(tx, actor.id, input);
    await audit(tx, {
      userId: actor.id, action: "STOCK_ADJUST", entity: "ProductBatch", entityId: res.batchId,
      before: { remainingQty: res.before }, after: { remainingQty: res.after, mode: input.mode, reason: input.reason },
    });
    return res;
  });
  await syncNotifications();
  return r;
}
