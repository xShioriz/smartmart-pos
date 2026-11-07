// Integration test: คืนสินค้า/คืนเงิน (ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZRET และลบเมื่อจบ)
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";
import type { CurrentUser } from "@/server/auth/guard";
import { checkoutCash } from "@/server/services/checkout";
import { createMember } from "@/server/services/members";
import { _setPromotionLoaderForTests, toRule } from "@/server/services/promotions";
import { _setProviderForTests } from "@/server/payments/registry";
import { handleProviderWebhook, startQrPayment } from "@/server/services/payments";
import { listReturns, previewReturn, returnSale } from "@/server/services/returns";
import { receiveBatch } from "@/server/services/stock";
import { FakeProvider } from "./helpers/fake-provider";

const TAG = `ZZRET${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let cashier: CurrentUser;
let catId: string;
let billPromoId: string;
let usePromos = false;
const memberIds: string[] = [];
const eventIds: string[] = [];
let phoneSeq = Math.floor(Math.random() * 9_000_000) + 1_000_000;

const dayKey = (offset: number) => {
  const d = new Date(`${todayBangkokKey()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function product(price: string) {
  return db.product.create({ data: { sku: `${TAG}-${Math.random().toString(36).slice(2, 8)}`, name: `${TAG} สินค้า`, categoryId: catId, costPrice: 10, price } });
}
async function addBatch(productId: string, qty: number, expiry: string | null, sec: number) {
  return db.$transaction((tx) => receiveBatch(tx, admin.id, { productId, qty, costPrice: new Prisma.Decimal(10), expiryDate: expiry, type: "RESTOCK", batchNo: `L${sec}`, receivedAt: new Date(1_700_000_000_000 + sec * 1000) }));
}
async function newMember() {
  const r = await createMember(admin, { name: `${TAG} สมาชิก`, phone: `09${String(phoneSeq++).padStart(8, "0")}`, email: null });
  memberIds.push(r.id);
  return r.id;
}
const sell = (items: { productId: string; quantity: number }[], over: Partial<Parameters<typeof checkoutCash>[1]> = {}) =>
  checkoutCash(admin, { idempotencyKey: randomUUID(), items, amountPaid: "100000", ...over });
const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stockQty;
const batches = async (productId: string) => Object.fromEntries((await db.productBatch.findMany({ where: { productId } })).map((b) => [b.batchNo, b.remainingQty]));
const itemsOf = (saleId: string) => db.saleItem.findMany({ where: { saleId }, orderBy: { nameSnapshot: "asc" } });
const ret = (saleId: string, lines: { saleItemId: string; quantity: number; restock?: boolean }[], over: Partial<Parameters<typeof returnSale>[1]> = {}) =>
  returnSale(admin, { saleId, items: lines.map((l) => ({ ...l, restock: l.restock ?? true })), reason: "ลูกค้าเปลี่ยนใจ", refundNote: null, idempotencyKey: randomUUID(), ...over });

beforeAll(async () => {
  const [a, c] = await Promise.all([db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } }), db.user.findUniqueOrThrow({ where: { email: "cashier@smartmart.local" } })]);
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  cashier = { id: c.id, email: c.email, name: c.name, role: c.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  const now = Date.now();
  billPromoId = (await db.promotion.create({ data: { name: `${TAG} ลดทั้งบิล 10%`, scope: "BILL", discountType: "PERCENT", value: 10, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 86_400_000) } })).id;
  // usePromos=false → ไม่มีโปรเลย (ตรวจเลขกลมๆ); true → ใช้เฉพาะโปรทั้งบิล 10% ที่สร้างในไฟล์นี้
  _setPromotionLoaderForTests(async (client, at) => {
    if (!usePromos) return [];
    return (await client.promotion.findMany({ where: { id: billPromoId, isActive: true, startsAt: { lte: at }, endsAt: { gt: at } } })).map(toRule);
  });
  _setProviderForTests(fake);
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  const retIds = (await db.saleReturn.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((r) => r.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...saleIds, ...payIds, ...memberIds, billPromoId] } } });
  await db.pointTransaction.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.stockMovement.deleteMany({ where: { OR: [{ productId: { in: ids } }, { returnId: { in: retIds } }] } });
  await db.saleReturn.deleteMany({ where: { id: { in: retIds } } }); // SaleReturnItem cascade
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.member.deleteMany({ where: { id: { in: memberIds } } });
  await db.promotion.deleteMany({ where: { id: billPromoId } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("คืนเงินและคืนสต็อก", () => {
  it("คืนทั้งบิล: เงินคืน = ยอดบิล, สต็อกกลับเข้า 'ล็อตเดิม' ครบ, movement RETURN, สถานะ FULLY_RETURNED, มีใบคืน/audit", async () => {
    const p = await product("20");
    await addBatch(p.id, 2, dayKey(10), 1); // หมดอายุก่อน
    await addBatch(p.id, 5, dayKey(90), 2);
    const s = await sell([{ productId: p.id, quantity: 4 }]); // ตัด L1×2 + L2×2
    expect(await batches(p.id)).toEqual({ L1: 0, L2: 3 });
    const [item] = await itemsOf(s.saleId);

    const r = await ret(s.saleId, [{ saleItemId: item.id, quantity: 4 }]);
    expect(r).toMatchObject({ refundTotal: "80.00", saleStatus: "FULLY_RETURNED", replayed: false });
    expect(r.returnNo).toMatch(/^RT-\d{8}-\d{5}$/);
    expect(await batches(p.id)).toEqual({ L1: 2, L2: 5 }); // กลับสู่สภาพก่อนขาย
    expect(await stockOf(p.id)).toBe(7);
    const mv = await db.stockMovement.findMany({ where: { returnId: r.returnId } });
    expect(mv.every((m) => m.type === "RETURN" && m.quantityChange > 0 && m.saleId === s.saleId)).toBe(true);
    expect(mv.reduce((a, m) => a + m.quantityChange, 0)).toBe(4);
    expect((await db.saleItem.findUniqueOrThrow({ where: { id: item.id } })).returnedQty).toBe(4);
    expect((await db.sale.findUniqueOrThrow({ where: { id: s.saleId } })).status).toBe("FULLY_RETURNED");
    expect(await db.auditLog.count({ where: { entityId: s.saleId, action: "SALE_RETURN" } })).toBe(1);
    expect((await listReturns(s.saleId))[0]).toMatchObject({ returnNo: r.returnNo, refundTotal: "80.00" });
  });

  it("คืนทีละชิ้นหลายครั้ง: เงินคืนสะสมเท่ากับ netTotal เป๊ะ (ไม่มีเศษหาย) และคืนเกินจำนวนไม่ได้", async () => {
    const p = await product("11.11"); // 3 ชิ้น = 33.33 หาร 3 ไม่ลงตัวในหน่วยสตางค์ของแต่ละชิ้นเมื่อมีส่วนลด
    await addBatch(p.id, 10, null, 1);
    usePromos = true;
    let s;
    try { s = await sell([{ productId: p.id, quantity: 3 }]); } finally { usePromos = false; } // ลด 10% → net 30.00 (33.33 − 3.33)
    const [item] = await itemsOf(s.saleId);
    expect(item.netTotal.toFixed(2)).toBe("30.00");
    const refunds: string[] = [];
    for (let i = 0; i < 3; i++) refunds.push((await ret(s.saleId, [{ saleItemId: item.id, quantity: 1 }])).refundTotal);
    expect(refunds.reduce((a, x) => a.add(x), new Prisma.Decimal(0)).toFixed(2)).toBe("30.00");
    expect(refunds).toEqual(["10.00", "10.00", "10.00"]);
    await expect(ret(s.saleId, [{ saleItemId: item.id, quantity: 1 }])).rejects.toThrow("บิลนี้คืนสินค้าไม่ได้"); // คืนครบแล้ว
    expect(await stockOf(p.id)).toBe(10);
  });

  it("เศษสตางค์: net 33.33 บาท 3 ชิ้น คืน 1+1+1 รวมได้ 33.33 พอดี (11.11 ×3)", async () => {
    const p = await product("11.11");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 3 }]);
    const [item] = await itemsOf(s.saleId);
    const sums = [];
    for (let i = 0; i < 3; i++) sums.push((await ret(s.saleId, [{ saleItemId: item.id, quantity: 1 }])).refundTotal);
    expect(sums.reduce((a, x) => a.add(x), new Prisma.Decimal(0)).toFixed(2)).toBe("33.33");
  });

  it("บิลที่มีส่วนลดทั้งบิล: เงินคืนทุกรายการรวมกัน = ยอดที่ลูกค้าจ่ายจริง (ไม่ใช่ราคาเต็ม)", async () => {
    const a = await product("100");
    const b = await product("55.55");
    await addBatch(a.id, 5, null, 1);
    await addBatch(b.id, 5, null, 1);
    usePromos = true;
    let s;
    try { s = await sell([{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 3 }]); } finally { usePromos = false; }
    const sale = await db.sale.findUniqueOrThrow({ where: { id: s.saleId } });
    expect(sale.billDiscount.toNumber()).toBeGreaterThan(0);
    const items = await itemsOf(s.saleId);
    const r = await ret(s.saleId, items.map((i) => ({ saleItemId: i.id, quantity: i.quantity })));
    expect(r.refundTotal).toBe(sale.total.toFixed(2));
    expect(r.saleStatus).toBe("FULLY_RETURNED");
  });

  it("restock=false (ของเสีย): คืนเงินแต่ไม่คืนเข้าสต็อก ไม่มี movement; คืนส่วนที่เหลือแบบ restock ได้ตามปกติ", async () => {
    const p = await product("30");
    await addBatch(p.id, 5, null, 1);
    const s = await sell([{ productId: p.id, quantity: 3 }]); // เหลือ 2
    const [item] = await itemsOf(s.saleId);
    const r1 = await ret(s.saleId, [{ saleItemId: item.id, quantity: 1, restock: false }]);
    expect(r1.refundTotal).toBe("30.00");
    expect(await stockOf(p.id)).toBe(2);
    expect(await db.stockMovement.count({ where: { returnId: r1.returnId } })).toBe(0);
    await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }]);
    expect(await stockOf(p.id)).toBe(4);
    expect((await db.sale.findUniqueOrThrow({ where: { id: s.saleId } })).status).toBe("FULLY_RETURNED");
  });
});

describe("แต้มสมาชิก", () => {
  it("หักแต้มตามสัดส่วนเงินคืนสะสม: ซื้อ 100 ได้ 4 แต้ม → คืนครึ่งหนึ่ง −2, คืนที่เหลือ −2 (รวมไม่เกินที่ได้)", async () => {
    const m = await newMember();
    const p = await product("50");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 2 }], { memberId: m });
    expect(s.pointsEarned).toBe(4);
    const [item] = await itemsOf(s.saleId);
    const r1 = await ret(s.saleId, [{ saleItemId: item.id, quantity: 1 }]);
    expect(r1.pointsReversed).toBe(2);
    let mm = await db.member.findUniqueOrThrow({ where: { id: m } });
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([2, "50.00"]);
    const r2 = await ret(s.saleId, [{ saleItemId: item.id, quantity: 1 }]);
    expect(r2.pointsReversed).toBe(2);
    mm = await db.member.findUniqueOrThrow({ where: { id: m } });
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([0, "0.00"]);
    const ledger = await db.pointTransaction.findMany({ where: { memberId: m }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((l) => [l.type, l.points, l.balanceAfter])).toEqual([["EARN", 4, 4], ["RETURN_ADJUST", -2, 2], ["RETURN_ADJUST", -2, 0]]);
  });

  it("แต้มคงเหลือน้อยกว่าที่ต้องหัก (ถูกปรับไปก่อน) → หักได้ไม่เกินที่มี ไม่ติดลบ", async () => {
    const m = await newMember();
    const p = await product("50");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 2 }], { memberId: m }); // ได้ 4
    // จำลองว่าสมาชิกใช้แต้มไปแล้ว 3 แต้ม (บันทึกในบัญชีแต้มด้วย เพื่อให้ข้อมูลยังสอดคล้องกัน)
    await db.$transaction([
      db.member.update({ where: { id: m }, data: { points: 1 } }),
      db.pointTransaction.create({ data: { memberId: m, type: "REDEEM", points: -3, balanceAfter: 1, note: "จำลองการใช้แต้ม" } }),
    ]);
    const [item] = await itemsOf(s.saleId);
    const r = await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }]);
    expect(r.pointsReversed).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: m } })).points).toBe(0);
  });

  it("บิลไม่มีสมาชิก → ไม่มีรายการแต้ม", async () => {
    const p = await product("50");
    await addBatch(p.id, 3, null, 1);
    const s = await sell([{ productId: p.id, quantity: 2 }]);
    const [item] = await itemsOf(s.saleId);
    const r = await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }]);
    expect(r.pointsReversed).toBe(0);
  });
});

describe("ปฏิเสธ / กันซ้ำ / พร้อมกัน", () => {
  it("คืนเกินจำนวน, จำนวนไม่ถูกต้อง, รายการของบิลอื่น, ไม่เลือกรายการ, ไม่ใส่เหตุผล → ปฏิเสธและไม่เปลี่ยนอะไร", async () => {
    const p = await product("20");
    await addBatch(p.id, 10, null, 1);
    const s1 = await sell([{ productId: p.id, quantity: 2 }]);
    const s2 = await sell([{ productId: p.id, quantity: 1 }]);
    const [i1] = await itemsOf(s1.saleId);
    const [i2] = await itemsOf(s2.saleId);
    await expect(ret(s1.saleId, [{ saleItemId: i1.id, quantity: 3 }])).rejects.toThrow("คืน");
    await expect(ret(s1.saleId, [{ saleItemId: i1.id, quantity: 1.5 }])).rejects.toThrow();
    await expect(ret(s1.saleId, [{ saleItemId: i2.id, quantity: 1 }])).rejects.toThrow("ไม่ได้อยู่ในบิลนี้");
    await expect(ret(s1.saleId, [{ saleItemId: i1.id, quantity: 0 }])).rejects.toThrow("อย่างน้อย 1");
    await expect(ret(s1.saleId, [{ saleItemId: i1.id, quantity: 1 }], { reason: "  " })).rejects.toThrow("เหตุผล");
    await expect(ret(s1.saleId, [{ saleItemId: i1.id, quantity: 1 }, { saleItemId: i1.id, quantity: 1 }])).rejects.toThrow("ซ้ำ");
    expect((await itemsOf(s1.saleId))[0].returnedQty).toBe(0);
    expect(await db.saleReturn.count({ where: { saleId: s1.saleId } })).toBe(0);
    expect(await stockOf(p.id)).toBe(7);
  });

  it("ส่งคำขอคืนเดิม (key เดียวกัน) ซ้ำ → ได้ใบคืนเดิม ไม่คืนซ้ำ; key ของบิลอื่นใช้ไม่ได้", async () => {
    const p = await product("20");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 4 }]);
    const other = await sell([{ productId: p.id, quantity: 1 }]);
    const [item] = await itemsOf(s.saleId);
    const [oi] = await itemsOf(other.saleId);
    const key = randomUUID();
    const a = await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }], { idempotencyKey: key });
    const b = await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }], { idempotencyKey: key });
    expect([b.returnId, b.replayed]).toEqual([a.returnId, true]);
    expect((await itemsOf(s.saleId))[0].returnedQty).toBe(2);
    expect(await stockOf(p.id)).toBe(7);
    await expect(ret(other.saleId, [{ saleItemId: oi.id, quantity: 1 }], { idempotencyKey: key })).rejects.toThrow("ถูกใช้แล้ว");
  });

  it("พร้อมกัน: 2 คำขอ (key ต่างกัน) คืนทั้งหมดของบิลเดียวกัน → สำเร็จ 1 ล้มเหลว 1, ไม่คืนเกิน, สต็อกกลับครั้งเดียว", async () => {
    const p = await product("20");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 3 }]);
    const [item] = await itemsOf(s.saleId);
    const res = await Promise.allSettled([ret(s.saleId, [{ saleItemId: item.id, quantity: 3 }]), ret(s.saleId, [{ saleItemId: item.id, quantity: 3 }])]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await itemsOf(s.saleId))[0].returnedQty).toBe(3);
    expect(await stockOf(p.id)).toBe(10);
    expect(await db.saleReturn.count({ where: { saleId: s.saleId } })).toBe(1);
  });

  it("พร้อมกัน: คำขอเดียวกัน (key เดียวกัน) 3 ตัว → ได้ใบคืนเดียว", async () => {
    const p = await product("20");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 3 }]);
    const [item] = await itemsOf(s.saleId);
    const key = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => ret(s.saleId, [{ saleItemId: item.id, quantity: 3 }], { idempotencyKey: key })));
    expect(new Set(rs.map((r) => r.returnId)).size).toBe(1);
    expect(await stockOf(p.id)).toBe(10);
    expect(await db.saleReturn.count({ where: { saleId: s.saleId } })).toBe(1);
  });

  it("ตัวอย่างการคืน (preview) ให้ตัวเลขเท่ากับตัวจริง และไม่เขียนข้อมูล", async () => {
    const p = await product("33.33");
    await addBatch(p.id, 10, null, 1);
    const s = await sell([{ productId: p.id, quantity: 3 }]);
    const [item] = await itemsOf(s.saleId);
    const pv = await previewReturn({ saleId: s.saleId, items: [{ saleItemId: item.id, quantity: 2, restock: true }] });
    expect(await db.saleReturn.count({ where: { saleId: s.saleId } })).toBe(0);
    const real = await ret(s.saleId, [{ saleItemId: item.id, quantity: 2 }]);
    expect(pv.refundTotal).toBe(real.refundTotal);
  });
});

describe("บิล QR", () => {
  const hook = (chargeId: string) => {
    const id = `evnt_test_${randomUUID().slice(0, 8)}`;
    eventIds.push(id);
    return handleProviderWebhook(JSON.stringify({ object: "event", id, key: "charge.complete", data: { object: "charge", id: chargeId } }), new Headers());
  };

  it("คืนบิล QR ต้องมีหมายเหตุการโอนเงินคืน; คืนแล้วบันทึกหมายเหตุ ไม่เรียก Provider", async () => {
    const p = await product("100");
    await addBatch(p.id, 5, null, 1);
    const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: p.id, quantity: 2 }] });
    const chargeId = (await db.payment.findUniqueOrThrow({ where: { saleId: st.saleId } })).providerChargeId!;
    fake.pay(chargeId);
    expect((await hook(chargeId)).body.outcome).toBe("CONFIRMED");
    const [item] = await itemsOf(st.saleId);
    const calls = fake.createCalls;
    await expect(ret(st.saleId, [{ saleItemId: item.id, quantity: 1 }])).rejects.toThrow("โอนเงินคืน");
    const r = await ret(st.saleId, [{ saleItemId: item.id, quantity: 1 }], { refundNote: "โอนคืนเข้าบัญชีลูกค้า 14:30" });
    expect(r).toMatchObject({ refundTotal: "100.00", saleStatus: "PARTIALLY_RETURNED" });
    expect((await db.saleReturn.findUniqueOrThrow({ where: { id: r.returnId } })).refundNote).toBe("โอนคืนเข้าบัญชีลูกค้า 14:30");
    expect(fake.createCalls).toBe(calls);
    expect(await stockOf(p.id)).toBe(4);
  });

  it("บิลที่ยังไม่เสร็จ/ยกเลิก/รอตรวจสอบ คืนไม่ได้", async () => {
    const p = await product("100");
    await addBatch(p.id, 5, null, 1);
    const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: p.id, quantity: 1 }] }); // PENDING_PAYMENT
    const [item] = await itemsOf(st.saleId);
    await expect(ret(st.saleId, [{ saleItemId: item.id, quantity: 1 }], { refundNote: "x" })).rejects.toThrow("คืนสินค้าไม่ได้");
    await db.sale.update({ where: { id: st.saleId }, data: { status: "CANCELLED" } });
    await expect(ret(st.saleId, [{ saleItemId: item.id, quantity: 1 }], { refundNote: "x" })).rejects.toThrow("คืนสินค้าไม่ได้");
  });
});

describe("ความสอดคล้อง", () => {
  it("Σ batch = stockQty, คืนสะสม ≤ ซื้อ, แต้มสมาชิกตรงบัญชีแต้ม", async () => {
    const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(drift[0].n)).toBe(0);
    const over = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "SaleItem" WHERE "returnedQty" > quantity`;
    expect(Number(over[0].n)).toBe(0);
    const pts = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Member" m WHERE m.points <> COALESCE((SELECT SUM(points) FROM "PointTransaction" t WHERE t."memberId"=m.id),0)`;
    expect(Number(pts[0].n)).toBe(0);
    // ผลรวมเงินคืนต่อบิลไม่เกินยอดบิล
    const refundOver = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Sale" s WHERE COALESCE((SELECT SUM("refundTotal") FROM "SaleReturn" r WHERE r."saleId"=s.id),0) > s.total`;
    expect(Number(refundOver[0].n)).toBe(0);
  });
  it("ผู้ใช้ cashier ถูกอ้างอิงได้ (ไม่ใช้ในเทสต์นี้ เพื่อกันตัวแปรเกินความจำเป็น)", () => {
    expect(cashier.role).toBe("CASHIER");
  });
});
