// Checkout เงินสด — หัวใจของระบบ: transaction เดียว (Sale + SaleItem + ตัดสต็อก FEFO + Payment + เลขใบเสร็จ)
// ไม่รับราคา/ยอดรวม/สต็อกจาก client: รับเฉพาะ productId + quantity + เงินที่รับ + idempotencyKey
import { db } from "@/server/db";
import { D, round2 } from "@/lib/money";
import { toBangkokDateKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { uniqueViolationFields } from "@/server/prisma-errors";
import { calculateCart } from "./pricing";
import { consumeFefo } from "./stock";

export type CheckoutInput = {
  idempotencyKey: string;
  items: { productId: string; quantity: number }[];
  amountPaid: string; // สตริงเงิน (ตรวจรูปแบบแล้วที่ Zod)
};

export type CheckoutResult = { saleId: string; receiptNo: string; total: string; amountPaid: string; change: string; replayed: boolean };

export const MAX_LINE_QTY = 9999;
export const MAX_LINES = 100;

/** รวมแถวที่ productId ซ้ำ และเรียงตาม productId (ลำดับล็อกตายตัว → กัน deadlock) */
function mergeItems(items: CheckoutInput["items"]) {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  const merged = [...map.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => (a.productId < b.productId ? -1 : 1));
  if (merged.length === 0) throw new BusinessError("ตะกร้าว่างเปล่า");
  if (merged.length > MAX_LINES) throw new BusinessError(`รายการสินค้าเกิน ${MAX_LINES} รายการ`);
  for (const m of merged) {
    if (!Number.isInteger(m.quantity) || m.quantity < 1 || m.quantity > MAX_LINE_QTY) throw new BusinessError(`จำนวนสินค้าต้องอยู่ระหว่าง 1–${MAX_LINE_QTY}`);
  }
  return merged;
}

async function findExisting(idempotencyKey: string, actor: CurrentUser): Promise<CheckoutResult | null> {
  const sale = await db.sale.findUnique({ where: { idempotencyKey } });
  if (!sale) return null;
  if (sale.cashierId !== actor.id) throw new BusinessError("รหัสคำขอนี้ถูกใช้แล้ว");
  if (sale.status !== "COMPLETED" || !sale.receiptNo) throw new BusinessError("รายการนี้ยังไม่เสร็จสมบูรณ์");
  return { saleId: sale.id, receiptNo: sale.receiptNo, total: sale.total.toFixed(2), amountPaid: sale.amountPaid.toFixed(2), change: sale.changeAmount.toFixed(2), replayed: true };
}

export async function checkoutCash(actor: CurrentUser, input: CheckoutInput): Promise<CheckoutResult> {
  const merged = mergeItems(input.items);

  const existing = await findExisting(input.idempotencyKey, actor);
  if (existing) return existing;

  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1) สินค้า + ราคาจาก DB เท่านั้น
        const products = await tx.product.findMany({ where: { id: { in: merged.map((m) => m.productId) } } });
        const byId = new Map(products.map((p) => [p.id, p]));
        for (const m of merged) {
          const p = byId.get(m.productId);
          if (!p) throw new BusinessError("ไม่พบสินค้าบางรายการในระบบ กรุณารีเฟรชหน้า");
          if (!p.isActive) throw new BusinessError(`สินค้า "${p.name}" ปิดใช้งานแล้ว`);
        }

        // 2) คำนวณยอดจากราคาใน DB
        const cart = calculateCart(merged.map((m) => ({ productId: m.productId, unitPrice: byId.get(m.productId)!.price, quantity: m.quantity })));
        const paid = round2(input.amountPaid);
        if (paid.lt(cart.total)) throw new BusinessError(`รับเงินไม่พอ (ยอดรวม ${cart.total.toFixed(2)} บาท)`);
        const change = paid.sub(cart.total);

        // 3) สร้างบิลสถานะรอก่อน (ต้องมี saleId ให้ movement); ชน idempotencyKey = P2002 → คำขอซ้ำ
        const sale = await tx.sale.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            cashierId: actor.id,
            status: "PENDING_PAYMENT",
            subtotal: cart.subtotal,
            discountTotal: cart.discountTotal,
            total: cart.total,
            paymentMethod: "CASH",
            amountPaid: D(0),
            changeAmount: D(0),
          },
        });

        // 4) ตัดสต็อก FEFO ทีละสินค้า (เรียงตาม productId) + บันทึกรายการขาย snapshot
        for (const line of cart.lines) {
          const p = byId.get(line.productId)!;
          const allocations = await consumeFefo(tx, { productId: p.id, qty: line.quantity, type: "SALE", actorId: actor.id, saleId: sale.id });
          const costSum = allocations.reduce((s, a) => s.add(a.unitCost.mul(a.quantity)), D(0));
          const item = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: p.id,
              skuSnapshot: p.sku,
              nameSnapshot: p.name,
              unitPrice: line.unitPrice,
              unitCost: round2(costSum.div(line.quantity)),
              quantity: line.quantity,
              lineTotal: line.lineTotal,
              discountAmount: line.discountAmount,
              netTotal: line.netTotal,
            },
          });
          await tx.saleItemBatch.createMany({ data: allocations.map((a) => ({ saleItemId: item.id, batchId: a.batchId, quantity: a.quantity, unitCost: a.unitCost })) });
        }

        // 5) ชำระเงิน + ออกเลขใบเสร็จ + ปิดบิล
        await tx.payment.create({
          data: { saleId: sale.id, method: "CASH", status: "PAID", environment: "PRODUCTION", amount: cart.total, paidAt: new Date() },
        });
        const receiptNo = `SM-${toBangkokDateKey(sale.createdAt).replaceAll("-", "")}-${String(sale.saleNo).padStart(5, "0")}`;
        await tx.sale.update({ where: { id: sale.id }, data: { status: "COMPLETED", receiptNo, amountPaid: paid, changeAmount: change } });

        return { saleId: sale.id, receiptNo, total: cart.total.toFixed(2), amountPaid: paid.toFixed(2), change: change.toFixed(2), replayed: false } satisfies CheckoutResult;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    return result;
  } catch (e) {
    // คำขอซ้ำพร้อมกัน (key เดียวกัน): ตัวที่แพ้ชน unique → คืนบิลของตัวที่ชนะ
    if (uniqueViolationFields(e)?.includes("idempotencyKey")) {
      const again = await findExisting(input.idempotencyKey, actor);
      if (again) return again;
    }
    throw e;
  }
}
