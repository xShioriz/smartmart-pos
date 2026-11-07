// Integration test: FEFO / ปรับสต็อก / การแจ้งเตือน (ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZSTK และลบเมื่อจบ)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/result";
import { todayBangkokKey } from "@/lib/date";
import { adjustBatch, consumeFefo, InsufficientStockError, receiveBatch } from "@/server/services/stock";
import { syncNotifications } from "@/server/services/notifications";

const TAG = `ZZSTK${Date.now().toString(36).toUpperCase()}`;
let actorId: string;
let catId: string;
let seq = 0;

const dayKey = (offset: number) => {
  const d = new Date(`${todayBangkokKey()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function newProduct(minStock = 0) {
  seq++;
  return db.product.create({ data: { sku: `${TAG}-${seq}`, name: `${TAG} สินค้า ${seq}`, categoryId: catId, costPrice: 10, price: 20, minStock } });
}

/** สร้างล็อต: qty, expiry (yyyy-MM-dd|null), receivedAt = ลำดับเวลาที่กำหนด (วินาที) */
async function addBatch(productId: string, qty: number, expiry: string | null, receivedSec: number, cost = "10") {
  return db.$transaction((tx) =>
    receiveBatch(tx, actorId, { productId, qty, costPrice: new Prisma.Decimal(cost), expiryDate: expiry, type: "RESTOCK", batchNo: `L${receivedSec}-${qty}`, receivedAt: new Date(1_700_000_000_000 + receivedSec * 1000) }),
  );
}

const consume = (productId: string, qty: number) => db.$transaction((tx) => consumeFefo(tx, { productId, qty, type: "SALE", actorId }));
const remaining = async (productId: string) => Object.fromEntries((await db.productBatch.findMany({ where: { productId } })).map((b) => [b.batchNo, b.remainingQty]));

async function assertConsistent(productId: string) {
  const agg = await db.productBatch.aggregate({ where: { productId }, _sum: { remainingQty: true } });
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  expect(p.stockQty).toBe(agg._sum.remainingQty ?? 0);
}

beforeAll(async () => {
  actorId = (await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } })).id;
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
});

afterAll(async () => {
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  await db.notification.deleteMany({ where: { productId: { in: ids } } });
  await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("FEFO", () => {
  it("ตัดล็อตที่หมดอายุก่อน (ไม่ใช่ล็อตที่รับก่อน) และล็อตไม่มีวันหมดอายุเป็นลำดับท้ายสุด", async () => {
    const p = await newProduct();
    await addBatch(p.id, 10, null, 1); // ไม่มีวันหมดอายุ รับก่อนสุด
    await addBatch(p.id, 5, dayKey(100), 2);
    await addBatch(p.id, 3, dayKey(40), 3); // หมดอายุเร็วสุด รับทีหลัง

    const a1 = await consume(p.id, 4);
    expect(a1.map((a) => [a.batchNo, a.quantity])).toEqual([["L3-3", 3], ["L2-5", 1]]);
    expect(await remaining(p.id)).toEqual({ "L1-10": 10, "L2-5": 4, "L3-3": 0 });

    const a2 = await consume(p.id, 6); // เหลือ L2=4 แล้วข้ามไป L1 (ไม่มีวันหมดอายุ)
    expect(a2.map((a) => [a.batchNo, a.quantity])).toEqual([["L2-5", 4], ["L1-10", 2]]);
    await assertConsistent(p.id);
  });

  it("วันหมดอายุเท่ากัน → ล็อตที่รับก่อนถูกตัดก่อน", async () => {
    const p = await newProduct();
    await addBatch(p.id, 2, dayKey(50), 20);
    await addBatch(p.id, 2, dayKey(50), 10);
    const a = await consume(p.id, 3);
    expect(a.map((x) => [x.batchNo, x.quantity])).toEqual([["L10-2", 2], ["L20-2", 1]]);
  });

  it("บันทึก movement ต่อล็อตและ balanceAfter ต่อเนื่อง ตรงกับ stockQty", async () => {
    const p = await newProduct();
    await addBatch(p.id, 3, dayKey(10), 1);
    await addBatch(p.id, 7, dayKey(20), 2);
    await consume(p.id, 5);
    const mv = await db.stockMovement.findMany({ where: { productId: p.id, type: "SALE" }, orderBy: { createdAt: "asc" } });
    expect(mv.map((m) => [m.quantityChange, m.balanceAfter])).toEqual([[-3, 7], [-2, 5]]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(5);
  });

  it("ล็อตที่หมดอายุเมื่อวานขายไม่ได้ แต่หมดอายุวันนี้ยังขายได้", async () => {
    const p = await newProduct();
    await addBatch(p.id, 5, dayKey(-1), 1);
    await expect(consume(p.id, 1)).rejects.toThrow(InsufficientStockError);
    await addBatch(p.id, 2, dayKey(0), 2);
    const a = await consume(p.id, 2);
    expect(a.map((x) => x.batchNo)).toEqual(["L2-2"]);
    await expect(consume(p.id, 1)).rejects.toThrow(InsufficientStockError); // เหลือแต่ล็อตหมดอายุ
    expect(await remaining(p.id)).toEqual({ "L1-5": 5, "L2-2": 0 });
    await assertConsistent(p.id);
  });

  it("ขายพอดีหมด = สำเร็จ, เกิน 1 = ปฏิเสธและข้อมูลไม่เปลี่ยน", async () => {
    const p = await newProduct();
    await addBatch(p.id, 4, null, 1);
    await expect(consume(p.id, 5)).rejects.toThrow("สต็อกไม่พอ");
    expect(await remaining(p.id)).toEqual({ "L1-4": 4 });
    expect(await db.stockMovement.count({ where: { productId: p.id, type: "SALE" } })).toBe(0);
    await consume(p.id, 4);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty).toBe(0);
  });

  it("หลายสินค้าในธุรกรรมเดียว: สินค้าหนึ่งไม่พอ → rollback ทั้งหมด", async () => {
    const p1 = await newProduct();
    const p2 = await newProduct();
    await addBatch(p1.id, 5, null, 1);
    await addBatch(p2.id, 1, null, 1);
    await expect(
      db.$transaction(async (tx) => {
        await consumeFefo(tx, { productId: p1.id, qty: 3, type: "SALE", actorId });
        await consumeFefo(tx, { productId: p2.id, qty: 2, type: "SALE", actorId });
      }),
    ).rejects.toThrow(InsufficientStockError);
    expect((await db.product.findUniqueOrThrow({ where: { id: p1.id } })).stockQty).toBe(5);
    expect(await remaining(p1.id)).toEqual({ "L1-5": 5 });
    expect(await db.stockMovement.count({ where: { productId: p1.id, type: "SALE" } })).toBe(0);
  });

  it("จำนวนไม่ถูกต้อง (0, ทศนิยม, ติดลบ) ถูกปฏิเสธ", async () => {
    const p = await newProduct();
    await addBatch(p.id, 5, null, 1);
    for (const q of [0, 1.5, -1]) await expect(consume(p.id, q)).rejects.toThrow(BusinessError);
    expect(await remaining(p.id)).toEqual({ "L1-5": 5 });
  });

  it("พร้อมกัน: ขายชิ้นสุดท้าย 2 คำขอ → สำเร็จ 1 ล้มเหลว 1", async () => {
    const p = await newProduct();
    await addBatch(p.id, 1, null, 1);
    const results = await Promise.allSettled([consume(p.id, 1), consume(p.id, 1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientStockError);
    expect(await remaining(p.id)).toEqual({ "L1-1": 0 });
    await assertConsistent(p.id);
  });

  it("พร้อมกัน: สต็อก 3 ขาย 6 คำขอ ๆ ละ 1 ข้ามหลายล็อต → สำเร็จ 3 ไม่ติดลบ", async () => {
    const p = await newProduct();
    await addBatch(p.id, 2, dayKey(30), 1);
    await addBatch(p.id, 1, dayKey(60), 2);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => consume(p.id, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(Object.values(await remaining(p.id)).every((n) => n === 0)).toBe(true);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: "SALE" } })).toBe(3);
    await assertConsistent(p.id);
  });
});

describe("ปรับสต็อก / รับเข้า", () => {
  const adjust = (batchId: string, mode: "ADD" | "REMOVE" | "SET", qty: number, reason = "ทดสอบ") =>
    db.$transaction((tx) => adjustBatch(tx, actorId, { batchId, mode, qty, reason }));

  it("ลดเกินคงเหลือ/ไม่ใส่เหตุผล/ไม่เปลี่ยนค่า ถูกปฏิเสธ และไม่ทิ้งร่องรอย", async () => {
    const p = await newProduct();
    const b = await addBatch(p.id, 5, null, 1);
    await expect(adjust(b.id, "REMOVE", 6)).rejects.toThrow("ลดเกิน");
    await expect(adjust(b.id, "REMOVE", 1, "  ")).rejects.toThrow("เหตุผล");
    await expect(adjust(b.id, "SET", 5)).rejects.toThrow("ไม่เปลี่ยนแปลง");
    await expect(adjust(b.id, "ADD", 0)).rejects.toThrow();
    expect(await db.stockMovement.count({ where: { productId: p.id, type: "ADJUSTMENT" } })).toBe(0);
    expect(await remaining(p.id)).toEqual({ "L1-5": 5 });
  });

  it("REMOVE/ADD/SET ทำงานถูก: ADD/SET ที่เพิ่มจะเพิ่ม initialQty ไม่ผิด constraint และมี movement", async () => {
    const p = await newProduct();
    const b = await addBatch(p.id, 5, null, 1);
    await adjust(b.id, "REMOVE", 2, "เสียหาย");
    await adjust(b.id, "ADD", 4, "นับเจอเพิ่ม"); // 3 → 7 เกิน initialQty เดิม (5)
    let row = await db.productBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect([row.remainingQty, row.initialQty]).toEqual([7, 9]);
    await adjust(b.id, "SET", 1, "นับใหม่");
    row = await db.productBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.remainingQty).toBe(1);
    const mv = await db.stockMovement.findMany({ where: { productId: p.id, type: "ADJUSTMENT" }, orderBy: { createdAt: "asc" } });
    expect(mv.map((m) => [m.quantityChange, m.balanceAfter, m.note])).toEqual([[-2, 3, "เสียหาย"], [4, 7, "นับเจอเพิ่ม"], [-6, 1, "นับใหม่"]]);
    await assertConsistent(p.id);
  });

  it("เลขล็อตซ้ำในสินค้าเดียวกันถูกปฏิเสธ", async () => {
    const p = await newProduct();
    await addBatch(p.id, 5, null, 1);
    await expect(addBatch(p.id, 5, null, 1)).rejects.toThrow("มีอยู่แล้ว");
  });
});

describe("การแจ้งเตือน", () => {
  const mine = (ids: string[]) => db.notification.findMany({ where: { productId: { in: ids } }, orderBy: { dedupeKey: "asc" } });

  it("สร้างครั้งเดียว (ไม่ซ้ำเมื่อซิงก์ซ้ำ) และลบเมื่อเงื่อนไขหมดไป", async () => {
    const low = await newProduct(5);
    const out = await newProduct(0);
    const exp = await newProduct(0);
    await addBatch(low.id, 3, null, 1); // ≤ min 5 → LOW_STOCK
    await addBatch(exp.id, 10, dayKey(-3), 1); // หมดอายุแล้ว → EXPIRED
    await addBatch(exp.id, 10, dayKey(5), 2); // ใกล้หมดอายุ → NEAR_EXPIRY
    const ids = [low.id, out.id, exp.id];

    await syncNotifications();
    await syncNotifications();
    const types = (await mine(ids)).map((n) => n.type).sort();
    expect(types).toEqual(["EXPIRED", "LOW_STOCK", "NEAR_EXPIRY", "OUT_OF_STOCK"]);

    // เติมสต็อก low → แจ้งเตือนหายไป; ตัดล็อตหมดอายุ → หายไป
    await addBatch(low.id, 20, null, 2);
    const expired = await db.productBatch.findFirstOrThrow({ where: { productId: exp.id, remainingQty: 10, expiryDate: { lt: new Date() } } });
    await db.$transaction((tx) => adjustBatch(tx, actorId, { batchId: expired.id, mode: "SET", qty: 0, reason: "ตัดจำหน่ายของหมดอายุ" }));
    await syncNotifications();
    expect((await mine(ids)).map((n) => n.type).sort()).toEqual(["NEAR_EXPIRY", "OUT_OF_STOCK"]);
  });

  it("สินค้าที่ปิดใช้งานไม่ถูกแจ้งเตือน", async () => {
    const p = await newProduct(0);
    await db.product.update({ where: { id: p.id }, data: { isActive: false } });
    await syncNotifications();
    expect(await mine([p.id])).toHaveLength(0);
  });
});
