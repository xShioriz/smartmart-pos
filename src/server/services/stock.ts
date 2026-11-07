// จุดเดียวที่แก้ ProductBatch.remainingQty / Product.stockQty (กฎใน CLAUDE.md ข้อ 6)
// ทุกฟังก์ชันต้องเรียกภายใน transaction (tx)
import { Prisma, type StockMovementType } from "@prisma/client";
import { todayBangkokKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";

type Tx = Prisma.TransactionClient;

export class InsufficientStockError extends BusinessError {
  constructor(public productId: string, public productName: string, public available: number, public requested: number) {
    super(`สต็อกไม่พอ: ${productName} เหลือขายได้ ${available} (ต้องการ ${requested})`);
  }
}

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

const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);

export type ReceiveBatchInput = {
  productId: string;
  qty: number;
  costPrice: Prisma.Decimal;
  expiryDate: string | null; // yyyy-MM-dd
  type: Extract<StockMovementType, "INITIAL" | "RESTOCK">;
  batchNo?: string | null;
  note?: string | null;
  receivedAt?: Date; // ใช้กับข้อมูลย้อนหลัง/ทดสอบ
};

/** รับสินค้าเข้าเป็น batch ใหม่ + บันทึก StockMovement */
export async function receiveBatch(tx: Tx, actorId: string, input: ReceiveBatchInput) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BusinessError("จำนวนรับเข้าต้องมากกว่า 0");
  const batchNo = input.batchNo?.trim() || (await nextBatchNo(tx, input.productId, input.type === "INITIAL" ? "INIT" : "LOT"));
  const dup = await tx.productBatch.findUnique({ where: { productId_batchNo: { productId: input.productId, batchNo } }, select: { id: true } });
  if (dup) throw new BusinessError(`เลขล็อต ${batchNo} มีอยู่แล้วในสินค้านี้`);
  const batch = await tx.productBatch.create({
    data: {
      productId: input.productId,
      batchNo,
      expiryDate: input.expiryDate ? dateOnly(input.expiryDate) : null,
      costPrice: input.costPrice,
      initialQty: input.qty,
      remainingQty: input.qty,
      ...(input.receivedAt && { receivedAt: input.receivedAt }),
    },
  });
  const balance = await recalculateProduct(tx, input.productId);
  await tx.stockMovement.create({
    data: { productId: input.productId, batchId: batch.id, type: input.type, quantityChange: input.qty, balanceAfter: balance, note: input.note ?? null, createdById: actorId },
  });
  return batch;
}

export type Allocation = { batchId: string; batchNo: string; quantity: number; unitCost: Prisma.Decimal };

type LockedBatch = { id: string; batchNo: string; remainingQty: number; costPrice: Prisma.Decimal };

/**
 * ตัดสต็อกตาม FEFO: ล็อตที่หมดอายุก่อนถูกตัดก่อน (expiryDate ว่าง = ท้ายสุด, เท่ากันใช้ receivedAt เก่าก่อน)
 * - ข้ามล็อตที่หมดอายุแล้ว (expiryDate < วันนี้ตามเวลาไทย) — หมดอายุวันนี้ยังขายได้ถึงสิ้นวัน
 * - ล็อกแถว (FOR UPDATE) ทำให้ checkout พร้อมกันบนสินค้าเดียวกันถูกจัดคิว
 * - ผู้เรียกที่ตัดหลายสินค้าต้องเรียงตาม productId เพื่อกัน deadlock
 * - ไม่พอ → throw InsufficientStockError (ผู้เรียกต้องปล่อยให้ transaction rollback)
 */
export async function consumeFefo(
  tx: Tx,
  input: { productId: string; qty: number; type: Extract<StockMovementType, "SALE">; actorId: string; saleId?: string | null; note?: string | null; now?: Date },
): Promise<Allocation[]> {
  const { productId, qty } = input;
  if (!Number.isInteger(qty) || qty <= 0) throw new BusinessError("จำนวนต้องเป็นจำนวนเต็มมากกว่า 0");
  const today = todayBangkokKey(input.now);

  const batches = await tx.$queryRaw<LockedBatch[]>`
    SELECT id, "batchNo", "remainingQty", "costPrice"
    FROM "ProductBatch"
    WHERE "productId" = ${productId}::uuid
      AND "remainingQty" > 0
      AND ("expiryDate" IS NULL OR "expiryDate" >= ${today}::date)
    ORDER BY "expiryDate" ASC NULLS LAST, "receivedAt" ASC, id ASC
    FOR UPDATE`;

  const available = batches.reduce((s, b) => s + b.remainingQty, 0);
  if (available < qty) {
    const p = await tx.product.findUnique({ where: { id: productId }, select: { name: true } });
    throw new InsufficientStockError(productId, p?.name ?? productId, available, qty);
  }

  const allocations: Allocation[] = [];
  let need = qty;
  for (const b of batches) {
    if (need === 0) break;
    const take = Math.min(b.remainingQty, need);
    const res = await tx.productBatch.updateMany({ where: { id: b.id, remainingQty: { gte: take } }, data: { remainingQty: { decrement: take } } });
    if (res.count !== 1) throw new BusinessError("สต็อกเปลี่ยนแปลงระหว่างทำรายการ กรุณาลองใหม่");
    allocations.push({ batchId: b.id, batchNo: b.batchNo, quantity: take, unitCost: new Prisma.Decimal(b.costPrice) });
    need -= take;
  }

  const finalBalance = await recalculateProduct(tx, productId);
  // balanceAfter ของแต่ละแถว = ยอดสุดท้าย + จำนวนที่ตัดหลังแถวนั้น
  let after = finalBalance + qty;
  for (const a of allocations) {
    after -= a.quantity;
    await tx.stockMovement.create({
      data: { productId, batchId: a.batchId, type: input.type, quantityChange: -a.quantity, balanceAfter: after, note: input.note ?? null, saleId: input.saleId ?? null, createdById: input.actorId },
    });
  }
  return allocations;
}

export type AdjustMode = "ADD" | "REMOVE" | "SET";

/**
 * ปรับสต็อกราย batch (นับสต็อก/เสียหาย/หมดอายุ) พร้อมเหตุผล
 * ADD/SET ที่เพิ่มขึ้นจะเพิ่ม initialQty ตามส่วนที่เพิ่ม (เพื่อให้ remainingQty <= initialQty เสมอ)
 */
export async function adjustBatch(tx: Tx, actorId: string, input: { batchId: string; mode: AdjustMode; qty: number; reason: string }) {
  if (!input.reason.trim()) throw new BusinessError("กรุณาระบุเหตุผลการปรับสต็อก");
  if (!Number.isInteger(input.qty) || input.qty < 0) throw new BusinessError("จำนวนไม่ถูกต้อง");
  if (input.mode !== "SET" && input.qty === 0) throw new BusinessError("จำนวนต้องมากกว่า 0");

  const rows = await tx.$queryRaw<{ id: string; productId: string; remainingQty: number; batchNo: string }[]>`
    SELECT id, "productId", "remainingQty", "batchNo" FROM "ProductBatch" WHERE id = ${input.batchId}::uuid FOR UPDATE`;
  const batch = rows[0];
  if (!batch) throw new BusinessError("ไม่พบล็อตสินค้า");

  const target = input.mode === "ADD" ? batch.remainingQty + input.qty : input.mode === "REMOVE" ? batch.remainingQty - input.qty : input.qty;
  if (target < 0) throw new BusinessError(`ลดเกินจำนวนคงเหลือ (ล็อต ${batch.batchNo} เหลือ ${batch.remainingQty})`);
  const delta = target - batch.remainingQty;
  if (delta === 0) throw new BusinessError("จำนวนไม่เปลี่ยนแปลง");

  await tx.productBatch.update({
    where: { id: batch.id },
    data: { remainingQty: target, ...(delta > 0 && { initialQty: { increment: delta } }) },
  });
  const balance = await recalculateProduct(tx, batch.productId);
  await tx.stockMovement.create({
    data: { productId: batch.productId, batchId: batch.id, type: "ADJUSTMENT", quantityChange: delta, balanceAfter: balance, note: input.reason.trim(), createdById: actorId },
  });
  return { productId: batch.productId, batchId: batch.id, before: batch.remainingQty, after: target, delta };
}
