// จุดเดียวที่แก้ ProductBatch.remainingQty / Product.stockQty (กฎใน CLAUDE.md ข้อ 6)
import type { Prisma, StockMovementType } from "@prisma/client";
import { todayBangkokKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";

type Tx = Prisma.TransactionClient;

/** ตั้ง Product.stockQty = ผลรวม remainingQty ของทุก batch แล้วคืนยอดรวม */
export async function recalculateProduct(tx: Tx, productId: string): Promise<number> {
  const agg = await tx.productBatch.aggregate({ where: { productId }, _sum: { remainingQty: true } });
  const total = agg._sum.remainingQty ?? 0;
  await tx.product.update({ where: { id: productId }, data: { stockQty: total } });
  return total;
}

async function nextBatchNo(tx: Tx, productId: string, prefix: string) {
  const n = await tx.productBatch.count({ where: { productId } });
  return `${prefix}-${todayBangkokKey().replaceAll("-", "")}-${String(n + 1).padStart(2, "0")}`;
}

export type ReceiveBatchInput = {
  productId: string;
  qty: number;
  costPrice: Prisma.Decimal;
  expiryDate: string | null; // yyyy-MM-dd
  type: Extract<StockMovementType, "INITIAL" | "RESTOCK">;
  batchNo?: string | null;
  note?: string | null;
};

/** รับสินค้าเข้าเป็น batch ใหม่ + บันทึก StockMovement (ต้องเรียกใน transaction) */
export async function receiveBatch(tx: Tx, actorId: string, input: ReceiveBatchInput) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BusinessError("จำนวนรับเข้าต้องมากกว่า 0");
  const batchNo = input.batchNo?.trim() || (await nextBatchNo(tx, input.productId, input.type === "INITIAL" ? "INIT" : "LOT"));
  const batch = await tx.productBatch.create({
    data: {
      productId: input.productId,
      batchNo,
      expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00.000Z`) : null,
      costPrice: input.costPrice,
      initialQty: input.qty,
      remainingQty: input.qty,
    },
  });
  const balance = await recalculateProduct(tx, input.productId);
  await tx.stockMovement.create({
    data: {
      productId: input.productId,
      batchId: batch.id,
      type: input.type,
      quantityChange: input.qty,
      balanceAfter: balance,
      note: input.note ?? null,
      createdById: actorId,
    },
  });
  return batch;
}
