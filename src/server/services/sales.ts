import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { bangkokDayRange } from "@/lib/date";
import { listReturns } from "./returns";
import type { CurrentUser } from "@/server/auth/guard";

export const SALES_PAGE_SIZE = 20;

export async function getStoreInfo() {
  const rows = await db.systemSetting.findMany({ where: { key: { in: ["store_name", "store_address", "store_phone", "receipt_footer"] } } });
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { name: m.store_name ?? "SmartMart", address: m.store_address ?? "", phone: m.store_phone ?? "", footer: m.receipt_footer ?? "" };
}

/** ใบเสร็จ: CASHIER ดูได้เฉพาะบิลของตนเอง, ADMIN ดูได้ทุกบิล — ไม่มีสิทธิ์ = null (เหมือนไม่พบ ไม่เปิดเผยว่ามีบิลอยู่) */
export async function getReceipt(id: string, viewer: CurrentUser) {
  const sale = await db.sale.findUnique({
    where: { id },
    include: { items: { orderBy: { nameSnapshot: "asc" } }, cashier: { select: { name: true } }, payment: true, member: { select: { code: true, name: true } }, pointTransactions: { where: { type: "EARN" }, select: { balanceAfter: true } } },
  });
  if (!sale || !sale.receiptNo) return null;
  if (viewer.role !== "ADMIN" && sale.cashierId !== viewer.id) return null;
  const store = await getStoreInfo();
  return {
    store,
    sale: {
      id: sale.id, receiptNo: sale.receiptNo, createdAt: sale.createdAt.toISOString(), status: sale.status, cashier: sale.cashier.name,
      paymentMethod: sale.paymentMethod, paymentEnv: sale.payment?.environment ?? null, subtotal: sale.subtotal.toFixed(2), discountTotal: sale.discountTotal.toFixed(2), billDiscount: sale.billDiscount.toFixed(2), billPromotionName: sale.billPromotionName, total: sale.total.toFixed(2),
      amountPaid: sale.amountPaid.toFixed(2), change: sale.changeAmount.toFixed(2),
      member: sale.member ? { code: sale.member.code, name: sale.member.name, pointsEarned: sale.pointsEarned, balanceAfter: sale.pointTransactions[0]?.balanceAfter ?? null } : null,
      items: sale.items.map((i) => ({ id: i.id, name: i.nameSnapshot, sku: i.skuSnapshot, quantity: i.quantity, unitPrice: i.unitPrice.toFixed(2), lineTotal: i.lineTotal.toFixed(2), discount: i.discountAmount.toFixed(2), net: i.netTotal.toFixed(2), promotionName: i.promotionName })),
    },
  };
}

export type SalesFilter = { q?: string; date?: string; page?: number; view?: "done" | "review" | "unfinished" };

export async function listSales(f: SalesFilter, viewer: CurrentUser) {
  const q = f.q?.trim().slice(0, 50);
  const where: Prisma.SaleWhereInput = {
    ...(f.view === "review" ? { status: "PAID_NEEDS_REVIEW" as const } : f.view === "unfinished" && viewer.role === "ADMIN" ? { status: { in: ["PENDING_PAYMENT", "CANCELLED"] as ("PENDING_PAYMENT" | "CANCELLED")[] } } : { OR: [{ receiptNo: { not: null } }, { status: "PAID_NEEDS_REVIEW" as const }] }),
    ...(viewer.role === "ADMIN" ? {} : { cashierId: viewer.id }),
    ...(q && { receiptNo: { contains: q, mode: "insensitive" as const } }),
    ...(f.date && (() => { const r = bangkokDayRange(f.date); return { createdAt: { gte: r.start, lt: r.end } }; })()),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.sale.findMany({
      where,
      include: { cashier: { select: { name: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * SALES_PAGE_SIZE,
      take: SALES_PAGE_SIZE,
    }),
    db.sale.count({ where }),
  ]);
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / SALES_PAGE_SIZE)),
    rows: rows.map((s) => ({ id: s.id, receiptNo: s.receiptNo, createdAt: s.createdAt.toISOString(), cashier: s.cashier.name, itemCount: s._count.items, total: s.total.toFixed(2), paymentMethod: s.paymentMethod, status: s.status })),
  };
}

/** รายละเอียดบิล (รวมบิลที่ยังไม่ปิด/ยกเลิก/รอตรวจสอบ) — CASHIER เห็นเฉพาะของตนเอง */
export async function getSaleDetail(id: string, viewer: CurrentUser) {
  const sale = await db.sale.findUnique({
    where: { id },
    include: { items: { orderBy: { nameSnapshot: "asc" } }, cashier: { select: { name: true } }, payment: true, member: { select: { id: true, code: true, name: true } } },
  });
  if (!sale) return null;
  if (viewer.role !== "ADMIN" && sale.cashierId !== viewer.id) return null;
  const pay = sale.payment;
  const returns = await listReturns(sale.id);
  return {
    id: sale.id, receiptNo: sale.receiptNo, status: sale.status, createdAt: sale.createdAt.toISOString(), cashier: sale.cashier.name,
    paymentMethod: sale.paymentMethod, subtotal: sale.subtotal.toFixed(2), discountTotal: sale.discountTotal.toFixed(2), total: sale.total.toFixed(2),
    amountPaid: sale.amountPaid.toFixed(2), change: sale.changeAmount.toFixed(2),
    billDiscount: sale.billDiscount.toFixed(2), billPromotionName: sale.billPromotionName, pointsEarned: sale.pointsEarned,
    member: sale.member,
    canReturn: viewer.role === "ADMIN" && (sale.status === "COMPLETED" || sale.status === "PARTIALLY_RETURNED"),
    isQr: sale.paymentMethod === "PROMPTPAY",
    returns,
    payment: pay && {
      status: pay.status, environment: pay.environment, provider: pay.provider, amount: pay.amount.toFixed(2),
      chargeRef: pay.providerChargeId ? `…${pay.providerChargeId.slice(-8)}` : null,
      paidAt: pay.paidAt?.toISOString() ?? null, confirmedVia: pay.confirmedVia, failureReason: pay.failureReason,
    },
    items: sale.items.map((i) => ({ id: i.id, name: i.nameSnapshot, sku: i.skuSnapshot, quantity: i.quantity, returnedQty: i.returnedQty, unitPrice: i.unitPrice.toFixed(2), lineTotal: i.lineTotal.toFixed(2), discount: i.discountAmount.toFixed(2), net: i.netTotal.toFixed(2), promotionName: i.promotionName })),
  };
}
