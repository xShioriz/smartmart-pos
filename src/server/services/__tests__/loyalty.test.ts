// Integration test: โปรโมชั่น + สมาชิก + แต้มสะสม ต่อเข้ากับ checkout เงินสดและ QR (ต่อ DB dev จริง)
// ข้อมูลทดสอบขึ้นต้น ZZLOY และลบเมื่อจบ; โปรโมชั่นที่ใช้ในเทสต์คือที่สร้างเองในไฟล์นี้เท่านั้น (loader ถูกสลับ)
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/guard";
import { BusinessError } from "@/lib/result";
import { _setProviderForTests } from "@/server/payments/registry";
import { checkoutCash, PriceChangedError } from "@/server/services/checkout";
import { createMember, listMembers, normalizePhone, searchMembersForPos, setMemberActive, updateMember } from "@/server/services/members";
import { _setPromotionLoaderForTests, toRule } from "@/server/services/promotions";
import { handleProviderWebhook, resolveReviewSale, startQrPayment } from "@/server/services/payments";
import { receiveBatch } from "@/server/services/stock";
import { createPromotionSchema } from "@/lib/validators/promotion";
import { FakeProvider } from "./helpers/fake-provider";

const TAG = `ZZLOY${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let cashier: CurrentUser;
let catId: string;
let p1: { id: string }, p2: { id: string }, p3: { id: string };
let itemPromoId: string, billPromoId: string;
const memberIds: string[] = [];
const eventIds: string[] = [];
let phoneSeq = Math.floor(Math.random() * 9_000_000) + 1_000_000;
const phone = () => `09${String(phoneSeq++).padStart(8, "0")}`;

async function newMember(name = `${TAG} สมาชิก`) {
  const r = await createMember(admin, { name, phone: phone(), email: null });
  memberIds.push(r.id);
  return r.id;
}
const member = (id: string) => db.member.findUniqueOrThrow({ where: { id } });
const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stockQty;
const sell = (items: { productId: string; quantity: number }[], over: Partial<Parameters<typeof checkoutCash>[1]> = {}, actor = admin) =>
  checkoutCash(actor, { idempotencyKey: randomUUID(), items, amountPaid: "100000", ...over });

async function product(price: string, stock: number) {
  const p = await db.product.create({ data: { sku: `${TAG}-${Math.random().toString(36).slice(2, 8)}`, name: `${TAG} สินค้า`, categoryId: catId, costPrice: 10, price } });
  await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: p.id, qty: stock, costPrice: new Prisma.Decimal(10), expiryDate: null, type: "RESTOCK", batchNo: "L1" }));
  return p;
}

beforeAll(async () => {
  const [a, c] = await Promise.all([db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } }), db.user.findUniqueOrThrow({ where: { email: "cashier@smartmart.local" } })]);
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  cashier = { id: c.id, email: c.email, name: c.name, role: c.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  p1 = await product("100", 50);
  p2 = await product("60", 50);
  p3 = await product("50", 100);
  const now = Date.now();
  const itemPromo = await db.promotion.create({ data: { name: `${TAG} ลด 10% สินค้า 1`, scope: "PRODUCT", discountType: "PERCENT", value: 10, productId: p1.id, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 86_400_000) } });
  const billPromo = await db.promotion.create({ data: { name: `${TAG} ครบ 150 ลด 20`, scope: "BILL", discountType: "FIXED", value: 20, minPurchase: 150, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 86_400_000) } });
  itemPromoId = itemPromo.id;
  billPromoId = billPromo.id;
  // ใช้เฉพาะโปรที่สร้างในไฟล์นี้ (อ่านสถานะล่าสุดจาก DB ทุกครั้ง → ทดสอบเปิด/ปิดโปรระหว่างทางได้)
  _setPromotionLoaderForTests(async (client, at) => {
    const rows = await client.promotion.findMany({ where: { id: { in: [itemPromoId, billPromoId] }, isActive: true, startsAt: { lte: at }, endsAt: { gt: at } } });
    return rows.map(toRule);
  });
  _setProviderForTests(fake);
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.notification.deleteMany({ where: { OR: [{ productId: { in: ids } }, { dedupeKey: { in: saleIds.map((s) => `PAYMENT_REVIEW:${s}`) } }] } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...saleIds, ...payIds, ...memberIds, itemPromoId, billPromoId] } }] } });
  await db.pointTransaction.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.member.deleteMany({ where: { id: { in: memberIds } } });
  await db.promotion.deleteMany({ where: { id: { in: [itemPromoId, billPromoId] } } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("checkout เงินสด + โปรโมชั่น + สมาชิก", () => {
  it("โปรรายการ + โปรทั้งบิล + แต้ม: ยอดและ snapshot ถูกต้อง, Σ net = total, สมาชิกได้แต้มใน transaction เดียวกัน", async () => {
    const m = await newMember();
    // p1 100x2=200 (-10% = -20 → 180) + p2 60x1 → ฐาน 240 ≥ 150 → ลดทั้งบิล 20 → 220
    const r = await sell([{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 1 }], { memberId: m, expectedTotal: "220.00", amountPaid: "250" });
    expect(r).toMatchObject({ total: "220.00", change: "30.00", pointsEarned: 8 }); // floor(220/25)=8

    const sale = await db.sale.findUniqueOrThrow({ where: { id: r.saleId }, include: { items: true } });
    expect(sale).toMatchObject({ memberId: m, pointsEarned: 8, billPromotionId: billPromoId, billPromotionName: `${TAG} ครบ 150 ลด 20` });
    expect([sale.subtotal, sale.discountTotal, sale.billDiscount, sale.total].map((x) => x.toFixed(2))).toEqual(["260.00", "40.00", "20.00", "220.00"]);
    expect(sale.items.reduce((s, i) => s.add(i.netTotal), new Prisma.Decimal(0)).toFixed(2)).toBe("220.00");
    expect(sale.items.reduce((s, i) => s.add(i.discountAmount), new Prisma.Decimal(0)).toFixed(2)).toBe("40.00");
    const i1 = sale.items.find((i) => i.productId === p1.id)!;
    expect([i1.promotionId, i1.promotionName]).toEqual([itemPromoId, `${TAG} ลด 10% สินค้า 1`]);
    expect(sale.items.find((i) => i.productId === p2.id)!.promotionId).toBeNull();

    const mm = await member(m);
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([8, "220.00"]);
    const ledger = await db.pointTransaction.findMany({ where: { memberId: m } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "EARN", points: 8, balanceAfter: 8, saleId: r.saleId });
    expect((await db.payment.findUniqueOrThrow({ where: { saleId: r.saleId } })).amount.toFixed(2)).toBe("220.00");
  });

  it("ยอดที่ client คาดไม่ตรง (ราคา/โปรเปลี่ยน) → ปฏิเสธ ไม่สร้างบิล ไม่ตัดสต็อก ไม่ให้แต้ม", async () => {
    const m = await newMember();
    const key = randomUUID();
    const before = await stockOf(p1.id);
    await expect(sell([{ productId: p1.id, quantity: 1 }], { idempotencyKey: key, memberId: m, expectedTotal: "100.00" })).rejects.toThrow(PriceChangedError); // จริง 90.00
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await stockOf(p1.id)).toBe(before);
    expect((await member(m)).points).toBe(0);
  });

  it("ปิดโปรระหว่างทาง → บิลถัดไปไม่มีส่วนลด (อ่านสถานะจาก DB ทุกครั้ง); บิลเก่ายังมี snapshot ชื่อโปร", async () => {
    const m = await newMember();
    const a = await sell([{ productId: p1.id, quantity: 1 }], { memberId: m });
    expect(a.total).toBe("90.00");
    await db.promotion.update({ where: { id: itemPromoId }, data: { isActive: false } });
    try {
      const b = await sell([{ productId: p1.id, quantity: 1 }], { memberId: m, expectedTotal: "100.00" });
      expect(b.total).toBe("100.00");
    } finally {
      await db.promotion.update({ where: { id: itemPromoId }, data: { isActive: true } });
    }
    const old = await db.saleItem.findFirstOrThrow({ where: { saleId: a.saleId } });
    expect(old.promotionName).toContain("ลด 10%");
  });

  it("สต็อกไม่พอ → rollback ทั้งบิล รวมถึงแต้มและยอดสะสมของสมาชิก", async () => {
    const m = await newMember();
    const key = randomUUID();
    await expect(sell([{ productId: p2.id, quantity: 1 }, { productId: p3.id, quantity: 9999 }], { idempotencyKey: key, memberId: m })).rejects.toThrow();
    const mm = await member(m);
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([0, "0.00"]);
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await db.pointTransaction.count({ where: { memberId: m } })).toBe(0);
  });

  it("ส่งคำขอเดิมซ้ำ (key เดียวกัน) → ไม่ให้แต้มซ้ำ", async () => {
    const m = await newMember();
    const key = randomUUID();
    const r1 = await sell([{ productId: p3.id, quantity: 2 }], { idempotencyKey: key, memberId: m }); // 100 → 4 แต้ม
    const r2 = await sell([{ productId: p3.id, quantity: 2 }], { idempotencyKey: key, memberId: m });
    expect([r1.pointsEarned, r2.replayed, r2.pointsEarned]).toEqual([4, true, 4]);
    expect((await member(m)).points).toBe(4);
    expect(await db.pointTransaction.count({ where: { memberId: m } })).toBe(1);
  });

  it("เศษแต้ม: 24.99 บาท = 0 แต้ม (ไม่มีรายการในบัญชีแต้ม), 25 บาท = 1 แต้ม", async () => {
    const m = await newMember();
    const cheap = await product("24.99", 5);
    const a = await sell([{ productId: cheap.id, quantity: 1 }], { memberId: m });
    expect(a.pointsEarned).toBe(0);
    expect(await db.pointTransaction.count({ where: { memberId: m } })).toBe(0);
    expect((await member(m)).totalSpent.toFixed(2)).toBe("24.99"); // ยอดสะสมยังนับ
    const exact = await product("25", 5);
    expect((await sell([{ productId: exact.id, quantity: 1 }], { memberId: m })).pointsEarned).toBe(1);
  });

  it("พร้อมกัน: 8 บิลของสมาชิกคนเดียว → แต้ม/ยอดสะสมรวมถูกต้อง และ balanceAfter เป็นลำดับต่อเนื่อง", async () => {
    const m = await newMember();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => sell([{ productId: p3.id, quantity: 1 }], { memberId: m }, i % 2 ? admin : cashier))); // 50 → 2 แต้ม
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const mm = await member(m);
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([16, "400.00"]);
    const bal = (await db.pointTransaction.findMany({ where: { memberId: m } })).map((l) => l.balanceAfter).sort((a, b) => a - b);
    expect(bal).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("สมาชิกไม่มีอยู่/ถูกปิดใช้งาน → ปฏิเสธ ไม่สร้างบิล", async () => {
    const m = await newMember();
    await setMemberActive(admin, { id: m, isActive: false });
    for (const bad of [m, randomUUID()]) {
      const key = randomUUID();
      await expect(sell([{ productId: p3.id, quantity: 1 }], { idempotencyKey: key, memberId: bad })).rejects.toThrow(BusinessError);
      expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
    }
  });

  it("ขายโดยไม่ระบุสมาชิก → ไม่มีแต้ม", async () => {
    const r = await sell([{ productId: p3.id, quantity: 4 }]);
    expect(r.pointsEarned).toBe(0);
  });
});

describe("QR + โปรโมชั่น + สมาชิก", () => {
  const hook = (chargeId: string) => {
    const id = `evnt_test_${randomUUID().slice(0, 8)}`;
    eventIds.push(id);
    return handleProviderWebhook(JSON.stringify({ object: "event", id, key: "charge.complete", data: { object: "charge", id: chargeId } }), new Headers());
  };
  const chargeOf = async (saleId: string) => (await db.payment.findUniqueOrThrow({ where: { saleId } })).providerChargeId!;

  it("ยอดที่เรียกเก็บจาก Provider = ยอดหลังส่วนลด; แต้มให้เมื่อได้รับเงินแล้วเท่านั้น และไม่ซ้ำเมื่อ webhook ซ้ำ", async () => {
    const m = await newMember();
    const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 1 }], memberId: m, expectedTotal: "220.00" });
    expect(st.amount).toBe("220.00");
    const chargeId = await chargeOf(st.saleId);
    expect(fake.charges.get(chargeId)!.amountSatang).toBe(22000);
    expect((await member(m)).points).toBe(0); // ยังไม่จ่าย → ยังไม่ได้แต้ม
    fake.pay(chargeId);
    expect((await hook(chargeId)).body.outcome).toBe("CONFIRMED");
    expect((await hook(chargeId)).body.outcome).toBe("ALREADY_PAID");
    const sale = await db.sale.findUniqueOrThrow({ where: { id: st.saleId } });
    expect([sale.status, sale.pointsEarned, sale.billPromotionId]).toEqual(["COMPLETED", 8, billPromoId]);
    const mm = await member(m);
    expect([mm.points, mm.totalSpent.toFixed(2)]).toEqual([8, "220.00"]);
    expect(await db.pointTransaction.count({ where: { memberId: m, type: "EARN" } })).toBe(1);
  });

  it("expectedTotal ไม่ตรง → ปฏิเสธก่อนสร้าง QR/บิล", async () => {
    const key = randomUUID();
    await expect(startQrPayment(admin, { idempotencyKey: key, items: [{ productId: p1.id, quantity: 1 }], expectedTotal: "100.00" })).rejects.toThrow(PriceChangedError);
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("จ่ายแล้วแต่สต็อกไม่พอ → ไม่ให้แต้ม; เมื่อผู้ดูแลทำรายการต่อสำเร็จจึงได้แต้ม; เลือกคืนเงิน → ไม่ได้แต้ม", async () => {
    const m = await newMember();
    const scarce = await product("100", 1);
    const mk = async () => {
      const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: scarce.id, quantity: 1 }], memberId: m });
      return { st, chargeId: await chargeOf(st.saleId) };
    };
    const a = await mk();
    await sell([{ productId: scarce.id, quantity: 1 }], {}, cashier); // ซื้อเงินสดตัดหมดก่อน (ไม่มีสมาชิก)
    fake.pay(a.chargeId);
    expect((await hook(a.chargeId)).body.outcome).toBe("PAID_NEEDS_REVIEW");
    expect((await member(m)).points).toBe(0);
    await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: scarce.id, qty: 3, costPrice: new Prisma.Decimal(10), expiryDate: null, type: "RESTOCK", batchNo: "REFILL" }));
    await resolveReviewSale(admin, { saleId: a.st.saleId, action: "FULFILL", note: "เติมสต็อกแล้ว" });
    expect((await member(m)).points).toBe(4); // 100 บาท
    expect((await db.sale.findUniqueOrThrow({ where: { id: a.st.saleId } })).pointsEarned).toBe(4);

    const b = await mk();
    await sell([{ productId: scarce.id, quantity: 2 }], {}, cashier); // ตัดหมดอีกครั้ง (เหลือ 2 → 0)
    fake.pay(b.chargeId);
    expect((await hook(b.chargeId)).body.outcome).toBe("PAID_NEEDS_REVIEW");
    await resolveReviewSale(admin, { saleId: b.st.saleId, action: "REFUNDED", note: "โอนคืนแล้ว" });
    expect((await member(m)).points).toBe(4); // ไม่เพิ่ม
  });
});

describe("จัดการสมาชิก", () => {
  it("รหัสสมาชิกรันต่อเนื่องไม่ซ้ำ แม้สร้างพร้อมกัน; เบอร์ซ้ำถูกปฏิเสธ", async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => newMember()));
    const codes = (await db.member.findMany({ where: { id: { in: created } } })).map((x) => x.code);
    expect(new Set(codes).size).toBe(5);
    expect(codes.every((c) => /^M\d{4,}$/.test(c))).toBe(true);
    const existing = await member(created[0]);
    await expect(createMember(admin, { name: "ซ้ำ", phone: existing.phone, email: null })).rejects.toThrow("เบอร์โทรนี้");
    await expect(updateMember(admin, { id: created[1], name: "x", phone: existing.phone, email: null })).rejects.toThrow("เบอร์โทรนี้");
  });

  it("ค้นหาที่ POS: คืนเฉพาะสมาชิกที่ใช้งานอยู่ และเห็นเบอร์แค่ 4 ตัวท้าย", async () => {
    const id = await newMember(`${TAG} ค้นหา`);
    const m = await member(id);
    const hit = (await searchMembersForPos(m.phone)).find((x) => x.id === id);
    expect(hit).toMatchObject({ code: m.code, name: m.name, phoneTail: m.phone.slice(-4) });
    expect(JSON.stringify(hit)).not.toContain(m.phone);
    expect(await searchMembersForPos("a")).toEqual([]);
    await setMemberActive(admin, { id, isActive: false });
    expect((await searchMembersForPos(m.phone)).find((x) => x.id === id)).toBeUndefined();
    expect((await listMembers({ q: m.phone })).items.some((x) => x.id === id)).toBe(true); // หน้าจัดการยังเห็น
  });

  it("normalizePhone ตัดช่องว่าง/ขีด", () => {
    expect(normalizePhone("081 234-5678")).toBe("0812345678");
  });
});

describe("validator โปรโมชั่น", () => {
  const ok = { name: "ทดสอบ", scope: "BILL", discountType: "PERCENT", value: "10", productId: "", categoryId: "", minPurchase: "100", startsAt: "2026-11-01T00:00", endsAt: "2026-11-30T23:59" };
  const bad = (o: Record<string, unknown>) => createPromotionSchema.safeParse({ ...ok, ...o }).success;
  it("รับค่าที่ถูกต้อง และตีความวันเวลาเป็นเวลาไทย", () => {
    const r = createPromotionSchema.parse(ok);
    expect(r.startsAt.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(r.minPurchase).toBe("100");
  });
  it("ปฏิเสธ: % เกิน 100, ส่วนลด 0/ติดลบ/ทศนิยมเกิน, ขาดเป้าหมาย, ยอดขั้นต่ำกับโปรที่ไม่ใช่ทั้งบิล, วันสิ้นสุดไม่หลังวันเริ่ม", () => {
    expect(bad({ value: "101" })).toBe(false);
    for (const v of ["0", "-5", "1.234"]) expect(bad({ value: v, discountType: "FIXED" }), v).toBe(false);
    expect(bad({ scope: "PRODUCT" })).toBe(false);
    expect(bad({ scope: "CATEGORY" })).toBe(false);
    expect(bad({ scope: "PRODUCT", productId: "x", minPurchase: "100" })).toBe(false);
    expect(bad({ endsAt: "2026-11-01T00:00" })).toBe(false);
    expect(bad({ startsAt: "ไม่ใช่วันที่" })).toBe(false);
  });
});
