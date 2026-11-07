// PromptPay QR ผ่าน Payment Provider (แผน v2.1)
// กฎเหล็ก: Payment เป็น PAID ได้ทางเดียว = confirmPaid() ซึ่งถูกเรียกหลังดึง Charge จาก Provider API เองและตรวจครบแล้วเท่านั้น
//   (webhook เป็นแค่สัญญาณให้ไปถาม Provider — ไม่เชื่อ body ของ webhook)
import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { D, round2, toSatang } from "@/lib/money";
import { toBangkokDateKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { uniqueViolationFields } from "@/server/prisma-errors";
import { getProvider } from "@/server/payments/registry";
import { ProviderError, type ProviderCharge } from "@/server/payments/types";
import { mergeItems, priceMerged } from "./checkout";
import { assertMemberUsable, awardPoints } from "./members";
import { consumeFefo, InsufficientStockError, lockSellable } from "./stock";
import { getSettingNumber } from "./settings";

export const QR_MIN_SATANG = 2000; // 20 บาท (ข้อจำกัดของ PromptPay ที่ Provider)
export const QR_MAX_SATANG = 15_000_000; // 150,000 บาท

export type QrState = {
  paymentId: string;
  saleId: string;
  status: PaymentStatus;
  saleStatus: string;
  amount: string;
  qrImageUrl: string | null;
  expiresAt: string | null;
  environment: "SANDBOX" | "PRODUCTION";
  receiptNo: string | null;
  failureReason: string | null;
};

async function stateOf(paymentId: string): Promise<QrState> {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { sale: true } });
  return {
    paymentId: p.id, saleId: p.saleId, status: p.status, saleStatus: p.sale.status, amount: p.amount.toFixed(2),
    qrImageUrl: p.qrImageUrl, expiresAt: p.expiresAt?.toISOString() ?? null, environment: p.environment,
    receiptNo: p.sale.receiptNo, failureReason: p.failureReason,
  };
}

/* ───────────── เริ่มชำระด้วย QR ───────────── */

export async function startQrPayment(actor: CurrentUser, input: { idempotencyKey: string; items: { productId: string; quantity: number }[]; memberId?: string | null; expectedTotal?: string | null }): Promise<QrState> {
  const merged = mergeItems(input.items);

  const replay = await findByKey(input.idempotencyKey, actor);
  if (replay) return replay;

  const provider = getProvider(); // ยังไม่ตั้ง/ตั้งผิด → error ก่อนแตะ DB
  const environment = provider.livemode ? "PRODUCTION" : "SANDBOX";

  let created: { saleId: string; paymentId: string; total: Prisma.Decimal };
  try {
    created = await db.$transaction(async (tx) => {
      if (input.memberId) await assertMemberUsable(tx, input.memberId);
      const { byId, cart } = await priceMerged(tx, merged, { expectedTotal: input.expectedTotal });
      const satang = toSatang(cart.total);
      if (satang < QR_MIN_SATANG) throw new BusinessError("ยอดต่ำกว่า 20 บาท ชำระด้วย QR ไม่ได้ กรุณาใช้เงินสด");
      if (satang > QR_MAX_SATANG) throw new BusinessError("ยอดเกิน 150,000 บาท ชำระด้วย QR ไม่ได้");

      // ตรวจสต็อกเบื้องต้น (ไม่ตัด/ไม่จอง) — ตรวจจริงตอนได้รับเงินแล้ว
      const today = toBangkokDateKey(new Date());
      for (const m of merged) {
        const rows = await tx.$queryRaw<{ qty: bigint | null }[]>`
          SELECT SUM("remainingQty")::bigint AS qty FROM "ProductBatch"
          WHERE "productId" = ${m.productId}::uuid AND "remainingQty" > 0 AND ("expiryDate" IS NULL OR "expiryDate" >= ${today}::date)`;
        const available = Number(rows[0]?.qty ?? 0);
        if (available < m.quantity) throw new InsufficientStockError(m.productId, byId.get(m.productId)!.name, available, m.quantity);
      }

      const sale = await tx.sale.create({
        data: {
          idempotencyKey: input.idempotencyKey, cashierId: actor.id, status: "PENDING_PAYMENT", subtotal: cart.subtotal,
          discountTotal: cart.discountTotal, billDiscount: cart.billDiscount, billPromotionId: cart.billPromotion?.id ?? null, billPromotionName: cart.billPromotion?.name ?? null,
          memberId: input.memberId ?? null, total: cart.total, paymentMethod: "PROMPTPAY", amountPaid: D(0), changeAmount: D(0),
        },
      });
      await tx.saleItem.createMany({
        data: cart.lines.map((l) => {
          const p = byId.get(l.productId)!;
          return { saleId: sale.id, productId: p.id, promotionId: l.promotion?.id ?? null, promotionName: l.promotion?.name ?? null, skuSnapshot: p.sku, nameSnapshot: p.name, unitPrice: l.unitPrice, unitCost: D(0), quantity: l.quantity, lineTotal: l.lineTotal, discountAmount: l.discountAmount, netTotal: l.netTotal };
        }),
      });
      const payment = await tx.payment.create({
        data: { saleId: sale.id, method: "PROMPTPAY", status: "PENDING", environment, provider: provider.name, amount: cart.total },
      });
      return { saleId: sale.id, paymentId: payment.id, total: cart.total };
    });
  } catch (e) {
    if (uniqueViolationFields(e)?.includes("idempotencyKey")) {
      const again = await findByKey(input.idempotencyKey, actor);
      if (again) return again;
    }
    throw e;
  }

  // เรียก Provider นอก transaction (เครือข่ายช้า/ล้มเหลวได้) — ถ้าล้มเหลวต้องไม่ทิ้งบิลค้าง
  const ttlMin = await getSettingNumber("qr_expire_minutes", 10);
  const wantExpires = new Date(Date.now() + ttlMin * 60_000);
  let charge: ProviderCharge;
  try {
    charge = await provider.createPromptPayCharge({
      amountSatang: toSatang(created.total), expiresAt: wantExpires, description: `SmartMart ${created.saleId.slice(0, 8)}`,
      metadata: { paymentId: created.paymentId, saleId: created.saleId }, idempotencyKey: created.paymentId,
    });
    assertChargeMatches(charge, { amountSatang: toSatang(created.total), livemode: provider.livemode });
    if (charge.status !== "pending" || !charge.qrImageUrl) throw new ProviderError("Provider ไม่ได้คืน QR ที่ใช้งานได้");
  } catch (e) {
    console.error("[payments] create charge failed", e);
    await markTerminal(created.paymentId, "FAILED", "สร้าง QR ไม่สำเร็จ");
    throw new BusinessError("สร้าง QR ไม่สำเร็จ กรุณาลองใหม่ หรือใช้เงินสด");
  }
  await db.payment.update({ where: { id: created.paymentId }, data: { providerChargeId: charge.id, qrImageUrl: charge.qrImageUrl, expiresAt: charge.expiresAt ?? wantExpires } });
  return stateOf(created.paymentId);
}

async function findByKey(key: string, actor: CurrentUser): Promise<QrState | null> {
  const sale = await db.sale.findUnique({ where: { idempotencyKey: key }, include: { payment: true } });
  if (!sale) return null;
  if (sale.cashierId !== actor.id) throw new BusinessError("รหัสคำขอนี้ถูกใช้แล้ว");
  if (!sale.payment || sale.payment.method !== "PROMPTPAY") throw new BusinessError("รหัสคำขอนี้ถูกใช้แล้ว");
  return stateOf(sale.payment.id);
}

function assertChargeMatches(c: ProviderCharge, want: { amountSatang: number; livemode: boolean }) {
  if (c.amountSatang !== want.amountSatang) throw new ProviderError(`ยอดไม่ตรง (${c.amountSatang} ≠ ${want.amountSatang})`);
  if (c.currency !== "THB") throw new ProviderError(`สกุลเงินไม่ใช่ THB (${c.currency})`);
  if (c.livemode !== want.livemode) throw new ProviderError("โหมด Provider (test/live) ไม่ตรงกับสภาพแวดล้อม");
}

/* ───────────── เปลี่ยนสถานะ ───────────── */

/** PENDING → FAILED/EXPIRED และยกเลิกบิลที่ยังไม่จ่าย (ทำได้เฉพาะเมื่อ Payment ยัง PENDING) */
async function markTerminal(paymentId: string, status: Extract<PaymentStatus, "FAILED" | "EXPIRED">, reason: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status, failureReason: reason } });
    if (r.count !== 1) return false;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { saleId: true } });
    await tx.sale.updateMany({ where: { id: p.saleId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });
    return true;
  });
}

type Tx = Prisma.TransactionClient;

/** ตัดสต็อกและปิดบิลของบิล QR ที่ได้รับเงินแล้ว; สต็อกไม่พอ → ไม่ตัดอะไรเลยและคืน NO_STOCK (ผู้เรียกตั้งสถานะ review) */
async function fulfillPaidSale(tx: Tx, saleId: string): Promise<"COMPLETED" | "NO_STOCK"> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
  const items = [...sale.items].sort((a, b) => (a.productId < b.productId ? -1 : 1)); // ลำดับล็อกตายตัว กัน deadlock
  for (const it of items) {
    if ((await lockSellable(tx, it.productId)) < it.quantity) return "NO_STOCK";
  }
  for (const it of items) {
    const allocations = await consumeFefo(tx, { productId: it.productId, qty: it.quantity, type: "SALE", actorId: sale.cashierId, saleId });
    const costSum = allocations.reduce((s, a) => s.add(a.unitCost.mul(a.quantity)), D(0));
    await tx.saleItem.update({ where: { id: it.id }, data: { unitCost: round2(costSum.div(it.quantity)) } });
    await tx.saleItemBatch.createMany({ data: allocations.map((a) => ({ saleItemId: it.id, batchId: a.batchId, quantity: a.quantity, unitCost: a.unitCost })) });
  }
  const receiptNo = `SM-${toBangkokDateKey(sale.createdAt).replaceAll("-", "")}-${String(sale.saleNo).padStart(5, "0")}`;
  await tx.sale.update({ where: { id: saleId }, data: { status: "COMPLETED", receiptNo, amountPaid: sale.total, changeAmount: D(0) } });
  await awardPoints(tx, saleId); // ให้แต้มเมื่อบิลปิดสมบูรณ์เท่านั้น (ไม่ให้ตอนยังรอจ่าย/รอตรวจสอบ)
  return "COMPLETED";
}

export type ConfirmOutcome =
  | "CONFIRMED" | "PAID_NEEDS_REVIEW" | "ALREADY_PAID" | "PAID_SALE_NOT_PENDING"
  | "STILL_PENDING" | "MARKED_FAILED" | "MARKED_EXPIRED" | "IGNORED_NOT_PAID" | "REVERSED_FLAGGED" | "REJECTED_MISMATCH" | "NO_CHARGE";

/** เปลี่ยน Payment → PAID + ปิดบิล (หรือส่งตรวจสอบถ้าสต็อกไม่พอ) — เรียกหลังตรวจ Charge จาก Provider แล้วเท่านั้น */
async function confirmPaid(paymentId: string, source: "webhook" | "reconcile"): Promise<ConfirmOutcome> {
  return db.$transaction(
    async (tx) => {
      // รับ PENDING และ FAILED/EXPIRED (จ่ายล่าช้าหลังหมดเวลา/แคชเชียร์ยกเลิก) — เงินเข้าแล้วต้องไม่หายจากระบบ
      const r = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ["PENDING", "EXPIRED", "FAILED"] } },
        data: { status: "PAID", paidAt: new Date(), confirmedVia: source, failureReason: null },
      });
      if (r.count !== 1) return "ALREADY_PAID";
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { sale: true } });
      if (payment.sale.status !== "PENDING_PAYMENT" && payment.sale.status !== "CANCELLED") return "PAID_SALE_NOT_PENDING";

      if ((await fulfillPaidSale(tx, payment.saleId)) === "COMPLETED") return "CONFIRMED";

      // เงินเข้าแล้ว → amountPaid = ยอดบิล (ผ่าน CHECK sale_paid_enough) แต่ยังไม่ออกเลขใบเสร็จ/ไม่ตัดสต็อก
      await tx.sale.update({ where: { id: payment.saleId }, data: { status: "PAID_NEEDS_REVIEW", amountPaid: payment.sale.total, changeAmount: D(0) } });
      await tx.notification.createMany({
        data: [{
          type: "PAYMENT_REVIEW", title: "ลูกค้าจ่ายแล้วแต่สต็อกไม่พอ",
          message: `บิล QR ${payment.amount.toFixed(2)} บาท ได้รับเงินแล้ว แต่สต็อกไม่พอสำหรับตัดขาย — ต้องคืนเงินลูกค้าหรือทำรายการต่อ (ดูที่ประวัติการขาย)`,
          dedupeKey: `PAYMENT_REVIEW:${payment.saleId}`,
        }],
        skipDuplicates: true,
      });
      return "PAID_NEEDS_REVIEW";
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** ดึง Charge จาก Provider มาตรวจเทียบกับ Payment ของเรา แล้วทำตามสถานะที่ Provider ยืนยัน */
export async function reconcilePayment(paymentId: string, source: "webhook" | "reconcile"): Promise<ConfirmOutcome> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.providerChargeId) return "NO_CHARGE";
  if (payment.status === "PAID") return "ALREADY_PAID";

  const provider = getProvider();
  const charge = await provider.retrieveCharge(payment.providerChargeId);

  const mismatch =
    charge.id !== payment.providerChargeId ||
    charge.amountSatang !== toSatang(payment.amount) ||
    charge.currency !== payment.currency ||
    charge.livemode !== (payment.environment === "PRODUCTION") ||
    (charge.metadata.paymentId !== undefined && charge.metadata.paymentId !== payment.id);
  if (mismatch) {
    console.error("[payments] charge mismatch", { paymentId, chargeId: charge.id });
    return "REJECTED_MISMATCH";
  }

  switch (charge.status) {
    case "successful":
      return charge.paid ? confirmPaid(paymentId, source) : "IGNORED_NOT_PAID";
    case "failed":
      await markTerminal(paymentId, "FAILED", charge.failureCode ?? "ชำระเงินไม่สำเร็จ");
      return "MARKED_FAILED";
    case "expired":
      await markTerminal(paymentId, "EXPIRED", "QR หมดอายุ");
      return "MARKED_EXPIRED";
    case "reversed":
      await db.notification.createMany({
        data: [{ type: "PAYMENT_REVIEW", title: "Provider ยกเลิกรายการชำระเงิน", message: `รายการชำระเงิน ${payment.amount.toFixed(2)} บาท ถูก reverse โดย Provider — ตรวจสอบบิลที่เกี่ยวข้อง`, dedupeKey: `PAYMENT_REVERSED:${payment.id}` }],
        skipDuplicates: true,
      });
      return "REVERSED_FLAGGED";
    default:
      return "STILL_PENDING";
  }
}

/* ───────────── สถานะ / ยกเลิก (เรียกจากหน้า POS) ───────────── */

async function loadOwned(actor: CurrentUser, paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { sale: { select: { cashierId: true } } } });
  if (!p || p.method !== "PROMPTPAY") throw new BusinessError("ไม่พบรายการชำระเงิน");
  if (actor.role !== "ADMIN" && p.sale.cashierId !== actor.id) throw new BusinessError("ไม่พบรายการชำระเงิน");
  return p;
}

const lastReconcile = new Map<string, number>();
const RECONCILE_EVERY_MS = 5_000;

/** poll จาก UI: ถ้ายัง PENDING จะถาม Provider ไม่ถี่เกิน 5 วินาทีต่อรายการ (เป็นตัวสำรองเมื่อ webhook ไม่มาหรือล่าช้า) */
export async function getQrStatus(actor: CurrentUser, paymentId: string): Promise<QrState> {
  const p = await loadOwned(actor, paymentId);
  if (p.status === "PENDING" && p.providerChargeId) {
    const last = lastReconcile.get(paymentId) ?? 0;
    if (Date.now() - last >= RECONCILE_EVERY_MS) {
      lastReconcile.set(paymentId, Date.now());
      try { await reconcilePayment(paymentId, "reconcile"); } catch (e) { console.error("[payments] reconcile failed", e instanceof Error ? e.message : e); }
    }
  }
  return stateOf(paymentId);
}

/** ยกเลิกโดยแคชเชียร์: Provider ไม่รองรับยกเลิก PromptPay → ยกเลิกฝั่งเรา; ถ้าลูกค้าสแกนจ่ายก่อนหมดเวลา ระบบยังรับเงินและเข้าสู่การตรวจสอบ */
export async function cancelQrPayment(actor: CurrentUser, paymentId: string): Promise<QrState> {
  const p = await loadOwned(actor, paymentId);
  if (p.status !== "PENDING") return stateOf(paymentId);
  const out = p.providerChargeId ? await reconcilePayment(paymentId, "reconcile").catch(() => "STILL_PENDING" as ConfirmOutcome) : "STILL_PENDING";
  if (out === "STILL_PENDING") {
    await markTerminal(paymentId, "FAILED", "CANCELLED_BY_CASHIER");
    await audit(db, { userId: actor.id, action: "PAYMENT_CANCEL", entity: "Payment", entityId: paymentId });
  }
  return stateOf(paymentId);
}

/* ───────────── ผู้ดูแลจัดการบิลที่ต้องตรวจสอบ ───────────── */

export async function resolveReviewSale(actor: CurrentUser, input: { saleId: string; action: "FULFILL" | "REFUNDED"; note: string }) {
  if (!input.note.trim()) throw new BusinessError("กรุณาระบุหมายเหตุ");
  await db.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, select: { status: true } });
    if (!sale) throw new BusinessError("ไม่พบบิล");
    if (sale.status !== "PAID_NEEDS_REVIEW") throw new BusinessError("บิลนี้ไม่ได้อยู่ในสถานะรอตรวจสอบ");
    if (input.action === "FULFILL") {
      if ((await fulfillPaidSale(tx, input.saleId)) === "NO_STOCK") throw new BusinessError("สต็อกยังไม่พอสำหรับตัดขาย");
    } else {
      await tx.sale.update({ where: { id: input.saleId }, data: { status: "CANCELLED" } });
    }
    await audit(tx, { userId: actor.id, action: input.action === "FULFILL" ? "PAYMENT_REVIEW_FULFILLED" : "PAYMENT_REVIEW_REFUNDED", entity: "Sale", entityId: input.saleId, after: { note: input.note.trim() } });
    await tx.notification.deleteMany({ where: { dedupeKey: `PAYMENT_REVIEW:${input.saleId}` } });
  });
}

/* ───────────── webhook ───────────── */

export type WebhookResult = { status: number; body: Record<string, unknown> };

export async function handleProviderWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
  let provider;
  try { provider = getProvider(); } catch { return { status: 503, body: { error: "payments disabled" } }; }

  const sig = provider.verifyWebhookSignature(rawBody, headers);
  if (!sig.valid) return { status: 401, body: { error: "invalid signature" } };

  let event: { id?: unknown; key?: unknown; data?: { id?: unknown; object?: unknown } };
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "invalid json" } }; }
  if (typeof event.id !== "string" || typeof event.key !== "string" || typeof event.data?.id !== "string") return { status: 400, body: { error: "invalid event" } };

  // บันทึก event (unique ที่ id): ซ้ำและประมวลผลแล้ว = ตอบ 200 ไม่ทำซ้ำ; ซ้ำแต่ยังไม่เสร็จ (ครั้งก่อนล้มกลางทาง) = ทำต่อ (confirmPaid idempotent)
  let record;
  try {
    record = await db.webhookEvent.create({
      data: { provider: provider.name, providerEventId: event.id, eventType: event.key, payload: JSON.parse(rawBody) as Prisma.InputJsonValue },
    });
  } catch (e) {
    if (!uniqueViolationFields(e)) throw e;
    record = await db.webhookEvent.findUniqueOrThrow({ where: { providerEventId: event.id } });
    if (record.processedAt) return { status: 200, body: { ok: true, duplicate: true } };
  }

  const finish = async (outcome: string, paymentId?: string) => {
    await db.webhookEvent.update({ where: { id: record.id }, data: { outcome: `${sig.checked ? "" : "UNSIGNED:"}${outcome}`, processedAt: new Date(), ...(paymentId && { paymentId }) } });
    return { status: 200, body: { ok: true, outcome } } satisfies WebhookResult;
  };

  if (event.key !== "charge.complete") return finish("IGNORED_EVENT");
  const payment = await db.payment.findUnique({ where: { providerChargeId: event.data.id }, select: { id: true } });
  if (!payment) return finish("UNKNOWN_CHARGE");

  try {
    return await finish(await reconcilePayment(payment.id, "webhook"), payment.id);
  } catch (e) {
    console.error("[payments] webhook processing failed", e instanceof Error ? e.message : e);
    await db.webhookEvent.update({ where: { id: record.id }, data: { outcome: "ERROR", paymentId: payment.id } });
    return { status: 500, body: { error: "processing failed" } };
  }
}
