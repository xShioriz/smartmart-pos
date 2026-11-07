// คืนสินค้า/คืนเงิน (อ้างอิงบิลเดิมเท่านั้น; คืนบางรายการ/บางจำนวนได้; ADMIN เท่านั้น — ตรวจที่ Server Action)
// กติกา (แผน v2/v2.1):
//  - เงินคืนคิดจาก SaleItem.netTotal (หลังส่วนลดรายการ+ส่วนลดทั้งบิลที่กระจายแล้ว) แบบสะสม: round2(net×คืนสะสม/จำนวน) − ที่คืนไปแล้ว
//    → คืนทีละชิ้นกี่ครั้งก็ตาม ผลรวมเท่ากับ netTotal เป๊ะ ไม่มีเศษหาย/เกิน
//  - คืนสต็อกเข้า "ล็อตเดิม" ตามที่ตัดไป (SaleItemBatch) เริ่มจากล็อตที่ถูกตัดทีหลังสุดใน FEFO; restock=false = ของเสีย ไม่คืนเข้าสต็อก
//  - หักแต้มตามสัดส่วนเงินคืนสะสม (floor) ไม่ต่ำกว่า 0; ลดยอดซื้อสะสมของสมาชิกตามเงินคืน
//  - บิล QR: ไม่ผ่าน Provider (Provider คืนเงิน PromptPay ไม่ได้) ต้องระบุหมายเหตุการโอนคืนนอกระบบ
import type { Prisma, SaleStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { D, round2 } from "@/lib/money";
import { toBangkokDateKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { uniqueViolationFields } from "@/server/prisma-errors";
import { recalculateProduct } from "./stock";

type Tx = Prisma.TransactionClient;

export type ReturnLineInput = { saleItemId: string; quantity: number; restock: boolean };
export type ReturnInput = { saleId: string; items: ReturnLineInput[]; reason: string; refundNote: string | null; idempotencyKey?: string | null };

const RETURNABLE: SaleStatus[] = ["COMPLETED", "PARTIALLY_RETURNED"];

export type ReturnPlan = {
  lines: { saleItemId: string; productId: string; name: string; quantity: number; restock: boolean; refund: Prisma.Decimal; before: number }[];
  refundTotal: Prisma.Decimal;
  pointsToReverse: number;
  isQr: boolean;
  memberId: string | null;
};

/** ตรวจเงื่อนไขและคำนวณเงินคืน/แต้มที่หัก — ไม่เขียนข้อมูล (ใช้ทั้งตัวอย่างและตัวจริง) */
async function plan(tx: Tx, input: ReturnInput): Promise<ReturnPlan> {
  const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, returns: { select: { pointsReversed: true } } } });
  if (!sale) throw new BusinessError("ไม่พบบิล");
  if (!RETURNABLE.includes(sale.status)) throw new BusinessError("บิลนี้คืนสินค้าไม่ได้ (ต้องเป็นบิลที่ขายสำเร็จแล้ว)");

  const wanted = input.items.filter((i) => i.quantity > 0);
  if (wanted.length === 0) throw new BusinessError("กรุณาเลือกสินค้าที่จะคืนอย่างน้อย 1 รายการ");
  if (new Set(wanted.map((w) => w.saleItemId)).size !== wanted.length) throw new BusinessError("มีรายการสินค้าซ้ำ");

  const byId = new Map(sale.items.map((i) => [i.id, i]));
  const lines = wanted.map((w) => {
    const it = byId.get(w.saleItemId);
    if (!it) throw new BusinessError("มีรายการที่ไม่ได้อยู่ในบิลนี้");
    if (!Number.isInteger(w.quantity) || w.quantity < 1) throw new BusinessError("จำนวนที่คืนต้องเป็นจำนวนเต็มมากกว่า 0");
    const left = it.quantity - it.returnedQty;
    if (w.quantity > left) throw new BusinessError(`คืน "${it.nameSnapshot}" ได้อีกไม่เกิน ${left} (ซื้อ ${it.quantity}, คืนไปแล้ว ${it.returnedQty})`);
    const after = it.returnedQty + w.quantity;
    const refund = round2(it.netTotal.mul(after).div(it.quantity)).sub(round2(it.netTotal.mul(it.returnedQty).div(it.quantity)));
    return { saleItemId: it.id, productId: it.productId, name: it.nameSnapshot, quantity: w.quantity, restock: w.restock, refund, before: it.returnedQty };
  });
  const refundTotal = lines.reduce((s, l) => s.add(l.refund), D(0));

  // แต้ม: เป้าหมายสะสม = floor(แต้มที่ได้ × เงินคืนสะสม / ยอดบิล) แล้วหักส่วนต่างจากที่หักไปแล้ว
  let pointsToReverse = 0;
  if (sale.memberId && sale.pointsEarned > 0 && sale.total.greaterThan(0)) {
    const cumRefund = sale.items.reduce((s, it) => {
      const add = lines.find((l) => l.saleItemId === it.id)?.quantity ?? 0;
      return s.add(round2(it.netTotal.mul(it.returnedQty + add).div(it.quantity)));
    }, D(0));
    const target = Math.floor(D(sale.pointsEarned).mul(cumRefund).div(sale.total).toNumber());
    const already = sale.returns.reduce((s, r) => s + r.pointsReversed, 0);
    pointsToReverse = Math.max(0, target - already);
  }
  return { lines, refundTotal, pointsToReverse, isQr: sale.paymentMethod === "PROMPTPAY", memberId: sale.memberId };
}

export async function previewReturn(input: Pick<ReturnInput, "saleId" | "items">) {
  const p = await plan(db, { ...input, reason: "", refundNote: null });
  return {
    lines: p.lines.map((l) => ({ saleItemId: l.saleItemId, name: l.name, quantity: l.quantity, refund: l.refund.toFixed(2) })),
    refundTotal: p.refundTotal.toFixed(2), pointsToReverse: p.pointsToReverse, isQr: p.isQr,
  };
}

export type ReturnResult = { returnId: string; returnNo: string; refundTotal: string; pointsReversed: number; saleStatus: SaleStatus; replayed: boolean };

async function existingByKey(key: string, saleId: string): Promise<ReturnResult | null> {
  const r = await db.saleReturn.findUnique({ where: { idempotencyKey: key }, include: { sale: { select: { status: true } } } });
  if (!r) return null;
  if (r.saleId !== saleId) throw new BusinessError("รหัสคำขอนี้ถูกใช้แล้ว");
  return { returnId: r.id, returnNo: r.returnNo, refundTotal: r.refundTotal.toFixed(2), pointsReversed: r.pointsReversed, saleStatus: r.sale.status, replayed: true };
}

export async function returnSale(actor: CurrentUser, input: ReturnInput): Promise<ReturnResult> {
  if (!input.reason.trim()) throw new BusinessError("กรุณาระบุเหตุผลการคืนสินค้า");
  if (input.idempotencyKey) {
    const replay = await existingByKey(input.idempotencyKey, input.saleId);
    if (replay) return replay;
  }
  try {
    return await db.$transaction(
      async (tx) => {
        // ล็อกบิล: คืนซ้อนกันบนบิลเดียวถูกจัดคิว (กันคืนเกินจำนวนที่ซื้อ)
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Sale" WHERE id = ${input.saleId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new BusinessError("ไม่พบบิล");
        if (input.idempotencyKey) {
          const dup = await tx.saleReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
          if (dup) {
            const st = await tx.sale.findUniqueOrThrow({ where: { id: dup.saleId }, select: { status: true } });
            return { returnId: dup.id, returnNo: dup.returnNo, refundTotal: dup.refundTotal.toFixed(2), pointsReversed: dup.pointsReversed, saleStatus: st.status, replayed: true };
          }
        }

        const p = await plan(tx, input);
        const note = input.refundNote?.trim() || null;
        if (p.isQr && !note) throw new BusinessError("บิลที่จ่ายด้วย QR ต้องระบุหมายเหตุการโอนเงินคืน (ระบบไม่คืนเงินผ่าน Provider)");

        const sale = await tx.sale.findUniqueOrThrow({ where: { id: input.saleId }, select: { cashierId: true } });
        void sale;
        const ret = await tx.saleReturn.create({
          data: {
            returnNo: `PENDING-${crypto.randomUUID()}`, idempotencyKey: input.idempotencyKey ?? null, saleId: input.saleId,
            reason: input.reason.trim(), refundTotal: p.refundTotal, refundNote: note ?? (p.isQr ? null : "คืนเงินสด"), createdById: actor.id,
          },
        });
        const returnNo = `RT-${toBangkokDateKey(ret.createdAt).replaceAll("-", "")}-${String(ret.returnSeq).padStart(5, "0")}`;

        // สินค้าเรียงตาม productId เพื่อลำดับล็อกคงที่ (กัน deadlock ระหว่างการคืนบิลต่างกันที่มีสินค้าเดียวกัน)
        const ordered = [...p.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1));
        for (const l of ordered) {
          const upd = await tx.saleItem.updateMany({
            where: { id: l.saleItemId, returnedQty: l.before }, // before = ค่าที่ plan อ่านไว้ (บิลถูกล็อกอยู่ จึงไม่ควรเปลี่ยน)
            data: { returnedQty: { increment: l.quantity } },
          });
          if (upd.count !== 1) throw new BusinessError("ข้อมูลการคืนเปลี่ยนแปลงระหว่างทำรายการ กรุณาลองใหม่");
          await tx.saleReturnItem.create({ data: { returnId: ret.id, saleItemId: l.saleItemId, quantity: l.quantity, refundAmount: l.refund, restock: l.restock } });

          if (l.restock) {
            const rows = await tx.saleItemBatch.findMany({ where: { saleItemId: l.saleItemId }, include: { batch: true } });
            // ล็อตที่ถูกตัดทีหลังสุดใน FEFO (หมดอายุไกลสุด/ไม่มีวันหมดอายุ) คืนก่อน
            rows.sort((a, b) => {
              const ea = a.batch.expiryDate?.getTime() ?? Infinity, eb = b.batch.expiryDate?.getTime() ?? Infinity;
              return eb - ea || b.batch.receivedAt.getTime() - a.batch.receivedAt.getTime() || (a.id < b.id ? -1 : 1);
            });
            let need = l.quantity;
            const takes: { batchId: string; qty: number }[] = [];
            for (const r of rows) {
              if (need === 0) break;
              const take = Math.min(r.quantity - r.restoredQty, need);
              if (take <= 0) continue;
              await tx.$queryRaw`SELECT id FROM "ProductBatch" WHERE id = ${r.batchId}::uuid FOR UPDATE`;
              await tx.saleItemBatch.update({ where: { id: r.id }, data: { restoredQty: { increment: take } } });
              await tx.productBatch.update({ where: { id: r.batchId }, data: { remainingQty: { increment: take } } });
              takes.push({ batchId: r.batchId, qty: take });
              need -= take;
            }
            if (need > 0) throw new BusinessError("คืนเข้าสต็อกไม่ได้: ข้อมูลล็อตที่ตัดไม่ครบ");
            const finalBalance = await recalculateProduct(tx, l.productId);
            let bal = finalBalance - takes.reduce((s, t) => s + t.qty, 0);
            for (const t of takes) {
              bal += t.qty;
              await tx.stockMovement.create({
                data: { productId: l.productId, batchId: t.batchId, type: "RETURN", quantityChange: t.qty, balanceAfter: bal, note: `คืนสินค้า ${returnNo}`, saleId: input.saleId, returnId: ret.id, createdById: actor.id },
              });
            }
          }
        }

        // สมาชิก: หักแต้ม (ไม่ต่ำกว่า 0) + ลดยอดซื้อสะสม
        let reversed = 0;
        if (p.memberId) {
          const m = await tx.$queryRaw<{ points: number }[]>`SELECT points FROM "Member" WHERE id = ${p.memberId}::uuid FOR UPDATE`;
          reversed = Math.min(p.pointsToReverse, m[0]?.points ?? 0);
          const after = await tx.member.update({
            where: { id: p.memberId },
            data: { totalSpent: { decrement: p.refundTotal }, ...(reversed > 0 && { points: { decrement: reversed } }) },
            select: { points: true },
          });
          if (reversed > 0) {
            await tx.pointTransaction.create({ data: { memberId: p.memberId, saleId: input.saleId, returnId: ret.id, type: "RETURN_ADJUST", points: -reversed, balanceAfter: after.points, note: `คืนสินค้า ${returnNo}` } });
          }
        }

        const items = await tx.saleItem.findMany({ where: { saleId: input.saleId }, select: { quantity: true, returnedQty: true } });
        const status: SaleStatus = items.every((i) => i.returnedQty === i.quantity) ? "FULLY_RETURNED" : "PARTIALLY_RETURNED";
        await tx.sale.update({ where: { id: input.saleId }, data: { status } });
        await tx.saleReturn.update({ where: { id: ret.id }, data: { returnNo, pointsReversed: reversed } });
        await audit(tx, {
          userId: actor.id, action: "SALE_RETURN", entity: "Sale", entityId: input.saleId,
          after: { returnNo, refundTotal: p.refundTotal.toFixed(2), reason: input.reason.trim(), note, pointsReversed: reversed, lines: p.lines.map((l) => ({ item: l.name, qty: l.quantity, refund: l.refund.toFixed(2), restock: l.restock })) },
        });
        return { returnId: ret.id, returnNo, refundTotal: p.refundTotal.toFixed(2), pointsReversed: reversed, saleStatus: status, replayed: false };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (input.idempotencyKey && uniqueViolationFields(e)?.includes("idempotencyKey")) {
      const again = await existingByKey(input.idempotencyKey, input.saleId);
      if (again) return again;
    }
    throw e;
  }
}

export async function listReturns(saleId: string) {
  const rows = await db.saleReturn.findMany({
    where: { saleId }, orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } }, items: { include: { saleItem: { select: { nameSnapshot: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id, returnNo: r.returnNo, createdAt: r.createdAt.toISOString(), reason: r.reason, refundTotal: r.refundTotal.toFixed(2), refundNote: r.refundNote,
    pointsReversed: r.pointsReversed, by: r.createdBy.name,
    items: r.items.map((i) => ({ id: i.id, name: i.saleItem.nameSnapshot, quantity: i.quantity, refund: i.refundAmount.toFixed(2), restock: i.restock })),
  }));
}
