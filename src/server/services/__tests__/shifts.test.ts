// Integration test: กะ/ปิดกะนับเงินสด (ต่อ DB dev; ข้อมูลทดสอบขึ้นต้น ZZSHF และถูกลบเมื่อจบ)
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { toBangkokDateKey } from "@/lib/date";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { closeShiftSchema, openShiftSchema } from "@/lib/validators/shift";
import { checkoutCash } from "@/server/services/checkout";
import { _setPromotionLoaderForTests } from "@/server/services/promotions";
import { _setProviderForTests } from "@/server/payments/registry";
import { handleProviderWebhook, startQrPayment } from "@/server/services/payments";
import { returnSale } from "@/server/services/returns";
import { receiveBatch } from "@/server/services/stock";
import { closeShift, computeFigures, getOpenShift, openShift } from "@/server/services/shifts";
import { FakeProvider } from "./helpers/fake-provider";

const TAG = `ZZSHF${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let catId: string;
let P: { id: string };
const eventIds: string[] = [];
const shiftIds: string[] = [];

const sell = (qty: number, when: Date) => checkoutCash(admin, { idempotencyKey: randomUUID(), items: [{ productId: P.id, quantity: qty }], amountPaid: "100000", at: when });

beforeAll(async () => {
  const open = await db.shift.findFirst({ where: { status: "OPEN" } });
  if (open) throw new Error("มีกะที่เปิดค้างอยู่ใน DB dev (ไม่ใช่ของเทสต์) — ปิดกะนั้นก่อนรันเทสต์นี้");
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  P = await db.product.create({ data: { sku: `${TAG}-P`, name: `${TAG} สินค้า`, categoryId: catId, costPrice: 40, price: 100 } });
  await db.$transaction((tx) => receiveBatch(tx, admin.id, { productId: P.id, qty: 200, costPrice: new Prisma.Decimal(40), expiryDate: null, type: "RESTOCK", batchNo: "R1" }));
  _setPromotionLoaderForTests(async () => []);
  _setProviderForTests(fake);
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const saleIds = (await db.saleItem.findMany({ where: { productId: P?.id }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  const retIds = (await db.saleReturn.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((r) => r.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...saleIds, ...payIds, ...shiftIds] } } });
  await db.notification.deleteMany({ where: { productId: P?.id } });
  await db.stockMovement.deleteMany({ where: { OR: [{ productId: P?.id }, { returnId: { in: retIds } }] } });
  await db.saleReturn.deleteMany({ where: { id: { in: retIds } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.shift.deleteMany({ where: { id: { in: shiftIds } } });
  await db.productBatch.deleteMany({ where: { productId: P?.id } });
  await db.product.deleteMany({ where: { id: P?.id } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("validators", () => {
  it("เงินทอน/เงินที่นับได้: ติดลบ ทศนิยมเกิน 2 ตำแหน่ง ตัวอักษร ถูกปฏิเสธ", () => {
    for (const bad of ["-1", "1.234", "abc", "", "1e3", "12345678"]) expect(() => openShiftSchema.parse({ openingCash: bad })).toThrow();
    expect(openShiftSchema.parse({ openingCash: "1000.50" }).openingCash).toBe("1000.50");
    expect(openShiftSchema.parse({ openingCash: 0 }).openingCash).toBe("0");
    expect(() => closeShiftSchema.parse({ shiftId: "x", countedCash: "10" })).toThrow();
  });
});

describe("ตัวเลขของกะ (computeFigures) เทียบกับค่าที่คำนวณเอง", () => {
  it("นับเฉพาะเงินสดในช่วงเวลา; QR ไม่เข้าลิ้นชัก; บิลนอกช่วงไม่นับ; เงินคืนบิลเงินสดหักตามเวลาคืน", async () => {
    const base = new Date(`${toBangkokDateKey(new Date())}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() - 500); // อดีตไกล ไม่ปนกับยอดขายจริงใน DB
    const t = (h: number, m = 0) => new Date(base.getTime() + h * 3600_000 + m * 60_000);

    await sell(1, t(8)); //   100  ก่อนช่วง → ไม่นับ
    await sell(2, t(10)); //  200
    const s2 = (await sell(3, t(11))).saleId; // 300
    await sell(1, t(12, 59)); // 100  ท้ายช่วง
    await sell(5, t(13)); //  500  เท่ากับ until → ไม่นับ ([from, until))

    // QR 1 บิล (100) ในช่วง — ต้องไม่เข้ายอดเงินสด แต่แสดงใน qrSales
    const st = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: P.id, quantity: 1 }] });
    const charge = (await db.payment.findUniqueOrThrow({ where: { saleId: st.saleId } })).providerChargeId!;
    fake.pay(charge);
    const evId = `evnt_test_${randomUUID().slice(0, 8)}`;
    eventIds.push(evId);
    await handleProviderWebhook(JSON.stringify({ object: "event", id: evId, key: "charge.complete", data: { object: "charge", id: charge } }), new Headers());
    await db.sale.update({ where: { id: st.saleId }, data: { createdAt: t(10, 30) } });

    // คืนสินค้าบิลเงินสด s2 จำนวน 1 ชิ้น (100) แล้วย้ายเวลาคืนเข้าในช่วง
    const it = (await db.saleItem.findMany({ where: { saleId: s2 } }))[0];
    await returnSale(admin, { saleId: s2, items: [{ saleItemId: it.id, quantity: 1, restock: true }], reason: "ทดสอบ", refundNote: null, idempotencyKey: randomUUID() });
    await db.saleReturn.updateMany({ where: { saleId: s2 }, data: { createdAt: t(11, 30) } });

    // คืนสินค้าบิลเงินสดนอกช่วงเวลา (ก่อนช่วง) ไม่นับ
    const sOut = (await sell(2, t(7))).saleId;
    const itOut = (await db.saleItem.findMany({ where: { saleId: sOut } }))[0];
    await returnSale(admin, { saleId: sOut, items: [{ saleItemId: itOut.id, quantity: 1, restock: true }], reason: "ทดสอบนอกช่วง", refundNote: null, idempotencyKey: randomUUID() });
    await db.saleReturn.updateMany({ where: { saleId: sOut }, data: { createdAt: t(7, 30) } });

    const f = await computeFigures(db, "1000", t(9), t(13));
    expect(f.cashSales).toBe("600.00"); // 200 + 300 + 100
    expect(f.billCount).toBe(3);
    expect(f.cashRefunds).toBe("100.00");
    expect(f.qrSales).toBe("100.00");
    expect(f.expected).toBe("1500.00"); // 1000 + 600 − 100
  });
});

describe("เปิด/ปิดกะ", () => {
  it("เปิดกะซ้ำถูกปฏิเสธ และเปิดพร้อมกัน 3 คำขอสำเร็จเพียง 1", async () => {
    const results = await Promise.allSettled([1, 2, 3].map(() => openShift(admin, { openingCash: "1000" })));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(BusinessError);
    shiftIds.push((ok[0] as PromiseFulfilledResult<{ id: string }>).value.id);
    await expect(openShift(admin, { openingCash: "500" })).rejects.toThrow("มีกะที่เปิดอยู่แล้ว");
    expect((await getOpenShift())?.id).toBe(shiftIds[0]);
  });

  it("ปิดกะ: ยอดที่ควรมี = ตั้งต้น + เงินสด − เงินคืน; นับตรง → difference 0 ไม่ต้องมีหมายเหตุ และบันทึกค่า snapshot", async () => {
    const id = shiftIds[0];
    // ย้ายเวลาเปิดกะย้อนไป 10 นาที เพื่อไม่ขึ้นกับนาฬิกาของ DB เทียบกับเครื่องที่รัน
    const opened = new Date(Date.now() - 10 * 60_000);
    await db.shift.update({ where: { id }, data: { openedAt: opened } });
    const s1 = (await sell(2, new Date(Date.now() - 5 * 60_000))).saleId; // 200
    await sell(1, new Date(Date.now() - 4 * 60_000)); //                      100
    const it = (await db.saleItem.findMany({ where: { saleId: s1 } }))[0];
    await returnSale(admin, { saleId: s1, items: [{ saleItemId: it.id, quantity: 1, restock: true }], reason: "ทดสอบ", refundNote: null, idempotencyKey: randomUUID() }); // คืน 100 (เวลาคืน = ตอนนี้)

    const r = await closeShift(admin, closeShiftSchema.parse({ shiftId: id, countedCash: "1200.00" }), new Date(Date.now() + 1000));
    expect(r).toMatchObject({ expected: "1200.00", counted: "1200.00", difference: "0.00" }); // 1000 + 300 − 100
    const row = await db.shift.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("CLOSED");
    expect(row.cashSales?.toFixed(2)).toBe("300.00");
    expect(row.cashRefunds?.toFixed(2)).toBe("100.00");
    expect(row.expectedCash?.toFixed(2)).toBe("1200.00");
    expect(row.closedById).toBe(admin.id);
    expect(await getOpenShift()).toBeNull();
  });

  it("ปิดกะที่ปิดแล้วซ้ำ → ปฏิเสธ; ไม่มีกะนี้ → ปฏิเสธ", async () => {
    await expect(closeShift(admin, closeShiftSchema.parse({ shiftId: shiftIds[0], countedCash: "1200" }))).rejects.toThrow("ปิดไปแล้ว");
    await expect(closeShift(admin, closeShiftSchema.parse({ shiftId: randomUUID(), countedCash: "1" }))).rejects.toThrow("ไม่พบกะ");
  });

  it("นับไม่ตรง: ต้องมีหมายเหตุ; เงินขาดได้ difference ติดลบ; เงินเกินเป็นบวก", async () => {
    const s = await openShift(admin, { openingCash: "500" });
    shiftIds.push(s.id);
    // ไม่ย้อนเวลาเปิดกะ: เงินคืนของเทสต์ก่อนหน้า (เวลาคืน = ก่อนหน้านี้) ต้องไม่ตกในกะนี้
    await expect(closeShift(admin, closeShiftSchema.parse({ shiftId: s.id, countedCash: "490" }))).rejects.toThrow("ระบุหมายเหตุ");
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("OPEN"); // ไม่ถูกปิดเมื่อถูกปฏิเสธ
    const r = await closeShift(admin, closeShiftSchema.parse({ shiftId: s.id, countedCash: "490", note: "ทอนเกิน 10 บาท" }));
    expect(r.difference).toBe("-10.00");

    const s2 = await openShift(admin, { openingCash: "500" });
    shiftIds.push(s2.id);
    const r2 = await closeShift(admin, closeShiftSchema.parse({ shiftId: s2.id, countedCash: "520.50", note: "เงินเกิน" }));
    expect(r2.difference).toBe("20.50");
  });

  it("ปิดกะพร้อมกัน 2 คำขอ → สำเร็จเพียง 1 (ไม่บันทึกซ้ำ)", async () => {
    const s = await openShift(admin, { openingCash: "100" });
    shiftIds.push(s.id);
    const input = closeShiftSchema.parse({ shiftId: s.id, countedCash: "100", note: "x" });
    const rs = await Promise.allSettled([closeShift(admin, input), closeShift(admin, input)]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "SHIFT_CLOSE", entityId: s.id } })).toBe(1);
  });

  it("บันทึก audit เปิด/ปิดกะครบ", async () => {
    expect(await db.auditLog.count({ where: { action: "SHIFT_OPEN", entityId: { in: shiftIds } } })).toBe(shiftIds.length);
    expect(await db.auditLog.count({ where: { action: "SHIFT_CLOSE", entityId: { in: shiftIds } } })).toBe(shiftIds.length);
  });

  it("ฐานข้อมูลกันข้อมูลผิด: เงินตั้งต้นติดลบ และกะที่ปิดแต่ข้อมูลไม่ครบ", async () => {
    await expect(db.shift.create({ data: { openedById: admin.id, openingCash: -1, status: "CLOSED" } })).rejects.toThrow();
    await expect(db.shift.create({ data: { openedById: admin.id, openingCash: 1, status: "CLOSED", closedAt: new Date() } })).rejects.toThrow();
  });
});
