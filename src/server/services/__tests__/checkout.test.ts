// Integration test: Checkout เงินสด (ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZCHK และลบเมื่อจบ)
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/result";
import { todayBangkokKey } from "@/lib/date";
import type { CurrentUser } from "@/server/auth/guard";
import { checkoutCash } from "@/server/services/checkout";
import { checkoutCashSchema } from "@/lib/validators/checkout";
import { InsufficientStockError, receiveBatch } from "@/server/services/stock";
import { _setPromotionLoaderForTests } from "@/server/services/promotions";

const TAG = `ZZCHK${Date.now().toString(36).toUpperCase()}`;
let admin: CurrentUser;
let cashier: CurrentUser;
let catId: string;
let seq = 0;

const dayKey = (offset: number) => {
  const d = new Date(`${todayBangkokKey()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function newProduct(price: string, cost = "10", active = true) {
  seq++;
  return db.product.create({ data: { sku: `${TAG}-${seq}`, name: `${TAG} สินค้า ${seq}`, categoryId: catId, costPrice: cost, price, isActive: active } });
}
async function addBatch(productId: string, qty: number, expiry: string | null, sec: number, cost = "10") {
  return db.$transaction((tx) =>
    receiveBatch(tx, admin.id, { productId, qty, costPrice: new Prisma.Decimal(cost), expiryDate: expiry, type: "RESTOCK", batchNo: `L${sec}`, receivedAt: new Date(1_700_000_000_000 + sec * 1000) }),
  );
}
const sell = (items: { productId: string; quantity: number }[], paid: string, actor = admin, key = randomUUID()) =>
  checkoutCash(actor, { idempotencyKey: key, items, amountPaid: paid });
const stock = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stockQty;

beforeAll(async () => {
  const [a, c] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } }),
    db.user.findUniqueOrThrow({ where: { email: "cashier@smartmart.local" } }),
  ]);
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  cashier = { id: c.id, email: c.email, name: c.name, role: c.role };
  catId = (await db.category.create({ data: { name: `${TAG} หมวด` } })).id;
  _setPromotionLoaderForTests(async () => []); // ตรวจยอดเงินแน่นอน ไม่ปนกับโปรโมชั่นจริงใน DB
});

afterAll(async () => {
  _setPromotionLoaderForTests(null);
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  await db.notification.deleteMany({ where: { productId: { in: ids } } });
  await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } }); // SaleItem/SaleItemBatch cascade
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: catId } });
  await db.$disconnect();
});

describe("ขายสำเร็จ", () => {
  it("คำนวณยอด/เงินทอนจากราคาใน DB, ตัดสต็อก FEFO, บันทึกบิล+รายการ+ชำระเงิน+movement ครบ", async () => {
    const a = await newProduct("15.50", "9");
    const b = await newProduct("7.25", "3");
    await addBatch(a.id, 2, dayKey(10), 1, "8"); // หมดอายุก่อน ทุน 8
    await addBatch(a.id, 5, dayKey(90), 2, "10"); // ทุน 10
    await addBatch(b.id, 10, null, 1, "3");

    const r = await sell([{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 4 }], "100");
    // 15.50*3 + 7.25*4 = 46.50 + 29.00 = 75.50 ; ทอน 24.50
    expect(r).toMatchObject({ total: "75.50", amountPaid: "100.00", change: "24.50", replayed: false });
    expect(r.receiptNo).toMatch(/^SM-\d{8}-\d{5}$/);

    const sale = await db.sale.findUniqueOrThrow({ where: { id: r.saleId }, include: { items: { include: { batches: true } }, payment: true } });
    expect(sale).toMatchObject({ status: "COMPLETED", paymentMethod: "CASH", cashierId: admin.id });
    expect(sale.subtotal.toFixed(2)).toBe("75.50");
    expect(sale.total.toFixed(2)).toBe("75.50");
    expect(sale.items.reduce((s, i) => s.add(i.netTotal), new Prisma.Decimal(0)).toFixed(2)).toBe(sale.total.toFixed(2));
    expect(sale.payment).toMatchObject({ method: "CASH", status: "PAID" });
    expect(sale.payment!.amount.toFixed(2)).toBe("75.50");

    const itemA = sale.items.find((i) => i.productId === a.id)!;
    expect(itemA).toMatchObject({ skuSnapshot: a.sku, nameSnapshot: a.name, quantity: 3 });
    expect(itemA.unitPrice.toFixed(2)).toBe("15.50");
    expect(itemA.batches.reduce((s, x) => s + x.quantity, 0)).toBe(3);
    expect(itemA.batches).toHaveLength(2); // ข้ามล็อต: 2 จากล็อตแรก + 1 จากล็อตที่สอง
    expect(itemA.unitCost.toFixed(2)).toBe("8.67"); // (2*8 + 1*10) / 3

    expect(await stock(a.id)).toBe(4);
    expect(await stock(b.id)).toBe(6);
    const mv = await db.stockMovement.findMany({ where: { saleId: sale.id } });
    expect(mv.every((m) => m.type === "SALE" && m.quantityChange < 0)).toBe(true);
    expect(mv.reduce((s, m) => s + m.quantityChange, 0)).toBe(-7);
  });

  it("เลขใบเสร็จไม่ซ้ำ และรวมแถวสินค้าซ้ำเป็นแถวเดียว", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 20, null, 1);
    const r1 = await sell([{ productId: p.id, quantity: 2 }, { productId: p.id, quantity: 3 }], "50");
    const r2 = await sell([{ productId: p.id, quantity: 1 }], "10");
    expect(r1.receiptNo).not.toBe(r2.receiptNo);
    expect(r1.total).toBe("50.00");
    expect(await db.saleItem.count({ where: { saleId: r1.saleId } })).toBe(1);
    expect(await stock(p.id)).toBe(14);
  });

  it("แก้ราคา/ปิดสินค้าภายหลัง ไม่กระทบบิลเก่า (snapshot)", async () => {
    const p = await newProduct("20");
    await addBatch(p.id, 5, null, 1);
    const r = await sell([{ productId: p.id, quantity: 1 }], "20");
    await db.product.update({ where: { id: p.id }, data: { price: "99", name: "เปลี่ยนชื่อ", isActive: false } });
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: r.saleId } });
    expect(item.unitPrice.toFixed(2)).toBe("20.00");
    expect(item.nameSnapshot).toContain(TAG);
  });
});

describe("ปฏิเสธ + rollback", () => {
  it("รับเงินไม่พอ → ปฏิเสธ ไม่ตัดสต็อก ไม่สร้างบิล", async () => {
    const p = await newProduct("30");
    await addBatch(p.id, 5, null, 1);
    const key = randomUUID();
    await expect(sell([{ productId: p.id, quantity: 2 }], "59.99", admin, key)).rejects.toThrow("รับเงินไม่พอ");
    expect(await stock(p.id)).toBe(5);
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
    expect((await sell([{ productId: p.id, quantity: 2 }], "60")).change).toBe("0.00"); // พอดี = ผ่าน
  });

  it("สินค้าหนึ่งในบิลสต็อกไม่พอ → ทั้งบิล rollback (สินค้าอื่นไม่ถูกตัด ไม่มี Sale/Payment/movement)", async () => {
    const ok = await newProduct("10");
    const lack = await newProduct("10");
    await addBatch(ok.id, 10, null, 1);
    await addBatch(lack.id, 1, null, 1);
    const key = randomUUID();
    await expect(sell([{ productId: ok.id, quantity: 5 }, { productId: lack.id, quantity: 2 }], "1000", admin, key)).rejects.toThrow(InsufficientStockError);
    expect(await stock(ok.id)).toBe(10);
    expect(await stock(lack.id)).toBe(1);
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await db.stockMovement.count({ where: { productId: { in: [ok.id, lack.id] }, type: "SALE" } })).toBe(0);
    expect(await db.productBatch.findMany({ where: { productId: ok.id } }).then((b) => b[0].remainingQty)).toBe(10);
  });

  it("ล็อตหมดอายุไม่ถูกขาย", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 5, dayKey(-1), 1);
    await expect(sell([{ productId: p.id, quantity: 1 }], "10")).rejects.toThrow("สต็อกไม่พอ");
    expect(await stock(p.id)).toBe(5);
  });

  it("สินค้าปิดใช้งาน/ไม่มีในระบบ → ปฏิเสธ", async () => {
    const p = await newProduct("10", "5", false);
    await addBatch(p.id, 5, null, 1);
    await expect(sell([{ productId: p.id, quantity: 1 }], "10")).rejects.toThrow("ปิดใช้งาน");
    await expect(sell([{ productId: randomUUID(), quantity: 1 }], "10")).rejects.toThrow(BusinessError);
    expect(await stock(p.id)).toBe(5);
  });

  it("Zod: จำนวน 0/ติดลบ/ทศนิยม/เกินสูงสุด, ตะกร้าว่าง, เงินรูปแบบผิด, key ไม่ใช่ uuid", () => {
    const base = { idempotencyKey: randomUUID(), items: [{ productId: randomUUID(), quantity: 1 }], amountPaid: "10", expectedTotal: "10" };
    expect(checkoutCashSchema.safeParse(base).success).toBe(true);
    for (const q of [0, -1, 1.5, 10000]) expect(checkoutCashSchema.safeParse({ ...base, items: [{ productId: randomUUID(), quantity: q }] }).success).toBe(false);
    expect(checkoutCashSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    for (const m of ["-5", "1.234", "abc", ""]) expect(checkoutCashSchema.safeParse({ ...base, amountPaid: m }).success).toBe(false);
    expect(checkoutCashSchema.safeParse({ ...base, idempotencyKey: "x" }).success).toBe(false);
    expect(checkoutCashSchema.safeParse({ ...base, expectedTotal: undefined }).success).toBe(false);
    expect(checkoutCashSchema.safeParse({ ...base, memberId: "ไม่ใช่ uuid" }).success).toBe(false);
    expect(checkoutCashSchema.safeParse({ ...base, memberId: null }).success).toBe(true);
  });
});

describe("กันขายซ้ำ / ขายพร้อมกัน", () => {
  it("ส่งคำขอเดิม (key เดียวกัน) ซ้ำ → ได้บิลเดิม ตัดสต็อกครั้งเดียว", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 10, null, 1);
    const key = randomUUID();
    const r1 = await sell([{ productId: p.id, quantity: 3 }], "30", admin, key);
    const r2 = await sell([{ productId: p.id, quantity: 3 }], "30", admin, key);
    expect(r2.saleId).toBe(r1.saleId);
    expect(r2.replayed).toBe(true);
    expect(await stock(p.id)).toBe(7);
    expect(await db.sale.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("คำขอเดียวกัน 2 ตัวพร้อมกัน (key เดียวกัน) → 1 บิล ตัดครั้งเดียว ทั้งสองได้ saleId เดียวกัน", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 10, null, 1);
    const key = randomUUID();
    const [r1, r2] = await Promise.all([sell([{ productId: p.id, quantity: 4 }], "40", admin, key), sell([{ productId: p.id, quantity: 4 }], "40", admin, key)]);
    expect(r1.saleId).toBe(r2.saleId);
    expect(await stock(p.id)).toBe(6);
    expect(await db.stockMovement.count({ where: { productId: p.id, type: "SALE" } })).toBe(1);
  });

  it("key ของแคชเชียร์คนอื่นใช้ไม่ได้", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 5, null, 1);
    const key = randomUUID();
    await sell([{ productId: p.id, quantity: 1 }], "10", admin, key);
    await expect(sell([{ productId: p.id, quantity: 1 }], "10", cashier, key)).rejects.toThrow("ถูกใช้แล้ว");
    expect(await stock(p.id)).toBe(4);
  });

  it("ชิ้นสุดท้าย: 2 บิลคนละ key พร้อมกัน → สำเร็จ 1 ล้มเหลว 1 สต็อกไม่ติดลบ", async () => {
    const p = await newProduct("10");
    await addBatch(p.id, 1, null, 1);
    const results = await Promise.allSettled([sell([{ productId: p.id, quantity: 1 }], "10", admin), sell([{ productId: p.id, quantity: 1 }], "10", cashier)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rej = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(rej.reason).toBeInstanceOf(InsufficientStockError);
    expect(await stock(p.id)).toBe(0);
    expect(await db.saleItem.count({ where: { productId: p.id } })).toBe(1);
  });

  it("บิลหลายสินค้าสลับลำดับกันพร้อมกัน (กัน deadlock) → ไม่ค้าง และสต็อกถูกต้อง", async () => {
    const a = await newProduct("10");
    const b = await newProduct("10");
    await addBatch(a.id, 20, null, 1);
    await addBatch(b.id, 20, null, 1);
    const jobs = Array.from({ length: 6 }, (_, i) =>
      sell(i % 2 ? [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] : [{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }], "20", i % 2 ? admin : cashier),
    );
    const res = await Promise.allSettled(jobs);
    expect(res.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await stock(a.id)).toBe(14);
    expect(await stock(b.id)).toBe(14);
  });

  it("ความสอดคล้อง: Σ batch = stockQty ทุกสินค้า และไม่มีบิลค้างสถานะ PENDING_PAYMENT", async () => {
    const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(drift[0].n)).toBe(0);
    expect(await db.sale.count({ where: { status: "PENDING_PAYMENT", payment: null } })).toBe(0);
  });
});
