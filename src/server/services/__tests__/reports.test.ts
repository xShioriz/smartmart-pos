// Integration test: รายงานยอดขายตรงกับ "ข้อมูลจริง" — ใช้ช่วงวันในอดีตไกล (ไม่ปนกับยอดขายจริงใน DB) และเทียบกับ oracle ที่คำนวณด้วย JS แยกทาง
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { toBangkokDateKey } from "@/lib/date";
import type { CurrentUser } from "@/server/auth/guard";
import { checkoutCash } from "@/server/services/checkout";
import { _setPromotionLoaderForTests } from "@/server/services/promotions";
import { _setProviderForTests } from "@/server/payments/registry";
import { handleProviderWebhook, startQrPayment, cancelQrPayment } from "@/server/services/payments";
import { returnSale } from "@/server/services/returns";
import { receiveBatch } from "@/server/services/stock";
import { dayTotals, daysBetween, salesReport, topProducts } from "@/server/services/reports";
import { FakeProvider } from "./helpers/fake-provider";

const TAG = `ZZREP${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let catId: string;
let P: { id: string }, Q: { id: string };
const eventIds: string[] = [];

// วันฐานอยู่ในอดีต ~400 วัน (ห่างจากข้อมูลจริงทุกชุด) — A = base, B = base+1
const dayShift = (n: number) => {
  const d = new Date(`${toBangkokDateKey(new Date())}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const A = dayShift(-400);
const B = dayShift(-399);
const at = (day: string, hhmmss: string) => new Date(`${day}T${hhmmss}+07:00`);

const sell = (items: { productId: string; quantity: number }[], when: Date) => checkoutCash(admin, { idempotencyKey: randomUUID(), items, amountPaid: "100000", at: when });
const itemsOf = (saleId: string) => db.saleItem.findMany({ where: { saleId } });

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  P = await db.product.create({ data: { sku: `${TAG}-P`, name: `${TAG} สินค้า P`, categoryId: catId, costPrice: 40, price: 100 } });
  Q = await db.product.create({ data: { sku: `${TAG}-Q`, name: `${TAG} สินค้า Q`, categoryId: catId, costPrice: 20, price: 50 } });
  for (const [p, cost] of [[P, 40], [Q, 20]] as const) {
    await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: p.id, qty: 100, costPrice: new Prisma.Decimal(cost), expiryDate: null, type: "RESTOCK", batchNo: "R1" }));
  }
  _setPromotionLoaderForTests(async () => []);
  _setProviderForTests(fake);
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const ids = [P?.id, Q?.id].filter(Boolean) as string[];
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  const retIds = (await db.saleReturn.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((r) => r.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...saleIds, ...payIds] } } });
  await db.notification.deleteMany({ where: { OR: [{ productId: { in: ids } }, { dedupeKey: { in: saleIds.map((s) => `PAYMENT_REVIEW:${s}`) } }] } });
  await db.stockMovement.deleteMany({ where: { OR: [{ productId: { in: ids } }, { returnId: { in: retIds } }] } });
  await db.saleReturn.deleteMany({ where: { id: { in: retIds } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("รายงานยอดขาย ตรงกับข้อมูลจริง", () => {
  let s2: string;

  it("เตรียมข้อมูล: เงินสด 5 บิล + QR 1 บิล + QR ที่ยกเลิก (ต้องไม่ถูกนับ) + คืนสินค้า 1 รายการ", async () => {
    await sell([{ productId: P.id, quantity: 1 }], at(A, "10:00:00")); // 100 (กำไร 60)
    s2 = (await sell([{ productId: P.id, quantity: 2 }, { productId: Q.id, quantity: 1 }], at(A, "15:00:00"))).saleId; // 250 (กำไร 150)
    await sell([{ productId: Q.id, quantity: 1 }], at(A, "23:59:30")); // 50 → ยังเป็นวัน A (เวลาไทย)
    await sell([{ productId: P.id, quantity: 1 }], at(B, "00:00:10")); // 100 → วัน B (UTC ยังเป็นวัน A)
    await sell([{ productId: P.id, quantity: 1 }], at(B, "12:00:00")); // 100

    // QR สำเร็จ 1 บิล แล้วย้ายเวลาไปวัน A
    const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: P.id, quantity: 1 }] });
    const charge = (await db.payment.findUniqueOrThrow({ where: { saleId: st.saleId } })).providerChargeId!;
    fake.pay(charge);
    const evId = `evnt_test_${randomUUID().slice(0, 8)}`;
    eventIds.push(evId);
    await handleProviderWebhook(JSON.stringify({ object: "event", id: evId, key: "charge.complete", data: { object: "charge", id: charge } }), new Headers());
    await db.sale.update({ where: { id: st.saleId }, data: { createdAt: at(A, "11:00:00") } });

    // QR ที่ยกเลิก (บิล CANCELLED) ย้ายไปวัน A — ต้องไม่นับเป็นยอดขาย
    const dead = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: P.id, quantity: 3 }] });
    await cancelQrPayment(admin, dead.paymentId);
    await db.sale.update({ where: { id: dead.saleId }, data: { createdAt: at(A, "12:00:00") } });

    // คืน P 1 ชิ้นของ s2 (คืนเข้าสต็อก) แล้วย้ายเวลาคืนไปวัน B
    const [pItem] = (await itemsOf(s2)).filter((i) => i.productId === P.id);
    const r = await returnSale(admin, { saleId: s2, items: [{ saleItemId: pItem.id, quantity: 1, restock: true }], reason: "ทดสอบรายงาน", refundNote: null, idempotencyKey: randomUUID() });
    expect(r.refundTotal).toBe("100.00");
    await db.saleReturn.update({ where: { id: r.returnId }, data: { createdAt: at(B, "13:00:00") } });
  });

  it("ตัวเลขรายวัน: บิล, ยอดขาย, เงินคืน, สุทธิ, กำไร, เงินสด/QR (เทียบค่าที่คำนวณมือ)", async () => {
    const rep = await salesReport({ from: A, to: B });
    expect(rep.rows.map((r) => r.day)).toEqual([A, B]);
    const [a, b] = rep.rows;
    // วัน A: 100 + 250 + 50 + QR 100 = 500 (4 บิล); กำไร 60+150+30+60 = 300; เงินสด 400 / QR 100
    expect([a.bills, a.gross, a.refunds, a.net, a.profit, a.cash, a.qr]).toEqual([4, "500.00", "0.00", "500.00", "300.00", "400.00", "100.00"]);
    // วัน B: 100 + 100 = 200 (2 บิล); คืน 100 (ทุน 40 กลับเข้าสต็อก → ผลกระทบกำไร −60) → กำไร 120 − 60 = 60
    expect([b.bills, b.gross, b.refunds, b.net, b.profit, b.cash, b.qr]).toEqual([2, "200.00", "100.00", "100.00", "60.00", "200.00", "0.00"]);
    expect(rep.totals).toMatchObject({ bills: 6, gross: "700.00", refunds: "100.00", net: "600.00", profit: "360.00", cash: "600.00", qr: "100.00", avgBill: "116.67" });
  });

  it("เทียบกับ oracle ที่คำนวณด้วย JS จากแถวดิบ (คนละเส้นทางกับ SQL aggregate)", async () => {
    const from = new Date(`${A}T00:00:00+07:00`), to = new Date(`${B}T23:59:59.999+07:00`);
    const sales = await db.sale.findMany({ where: { createdAt: { gte: from, lte: to }, status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] }, items: { some: { productId: { in: [P.id, Q.id] } } } }, include: { items: true } });
    const rets = await db.saleReturn.findMany({ where: { createdAt: { gte: from, lte: to }, sale: { items: { some: { productId: { in: [P.id, Q.id] } } } } } });
    const oracle = new Map<string, { bills: number; gross: Prisma.Decimal; refunds: Prisma.Decimal }>();
    const get = (d: string) => oracle.get(d) ?? oracle.set(d, { bills: 0, gross: new Prisma.Decimal(0), refunds: new Prisma.Decimal(0) }).get(d)!;
    for (const s of sales) { const o = get(toBangkokDateKey(s.createdAt)); o.bills++; o.gross = o.gross.add(s.total); }
    for (const r of rets) { const o = get(toBangkokDateKey(r.createdAt)); o.refunds = o.refunds.add(r.refundTotal); }
    const rep = await salesReport({ from: A, to: B });
    for (const row of rep.rows) {
      const o = oracle.get(row.day)!;
      expect([row.bills, row.gross, row.refunds]).toEqual([o.bills, o.gross.toFixed(2), o.refunds.toFixed(2)]);
    }
  });

  it("บิลที่ยกเลิก/รอจ่ายไม่ถูกนับ; ช่วงที่ไม่มีข้อมูลเป็น 0 ทั้งหมดและมีครบทุกวัน", async () => {
    const cancelled = await db.sale.count({ where: { status: "CANCELLED", items: { some: { productId: P.id } } } });
    expect(cancelled).toBeGreaterThan(0);
    const empty = await salesReport({ from: dayShift(-700), to: dayShift(-697) });
    expect(empty.rows).toHaveLength(4);
    expect(empty.totals).toMatchObject({ bills: 0, gross: "0.00", net: "0.00", avgBill: "0.00" });
  });

  it("สินค้าขายดีหักที่คืน: P = 1+2+1+1+1 − คืน 1 = 5 ชิ้น, Q = 2 ชิ้น", async () => {
    const top = await topProducts({ from: A, to: B }, 10);
    const p = top.find((t) => t.productId === P.id)!, q = top.find((t) => t.productId === Q.id)!;
    expect([p.units, p.revenue]).toEqual([5, "500.00"]);
    expect([q.units, q.revenue]).toEqual([2, "100.00"]);
    expect(top[0].productId).toBe(P.id); // เรียงตามจำนวนชิ้น
    expect((await topProducts({ from: A, to: B }, 1))).toHaveLength(1);
  });

  it("ขอบวันตามเวลาไทย: dayTotals เฉพาะวัน และ daysBetween ครบวัน", async () => {
    expect((await dayTotals(A)).bills).toBe(4);
    expect((await dayTotals(B)).bills).toBe(2);
    expect(daysBetween({ from: "2026-02-27", to: "2026-03-02" })).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});
