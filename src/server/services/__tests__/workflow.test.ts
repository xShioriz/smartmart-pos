// Integration test ข้ามโมดูล (Day 9): กระบวนการตั้งแต่ต้นจนจบ + ข้อมูลสาธิต + ตั้งค่า
// ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZWF และลบเมื่อจบ
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { toBangkokDateKey } from "@/lib/date";
import type { CurrentUser } from "@/server/auth/guard";
import { generateDemoSales } from "@/server/demo/seed-demo";
import { _setProviderForTests } from "@/server/payments/registry";
import { checkoutCash } from "@/server/services/checkout";
import { createCategory } from "@/server/services/categories";
import { createMember } from "@/server/services/members";
import { createProduct } from "@/server/services/products";
import { _setPromotionLoaderForTests, createPromotion, toRule } from "@/server/services/promotions";
import { handleProviderWebhook, startQrPayment } from "@/server/services/payments";
import { returnSale } from "@/server/services/returns";
import { salesReport } from "@/server/services/reports";
import { adjustStock } from "@/server/services/stock-ops";
import { getSettings, updateSettings } from "@/server/services/settings";
import { listNotifications, syncNotifications } from "@/server/services/notifications";
import { settingsSchema } from "@/lib/validators/settings";
import { createProductSchema } from "@/lib/validators/product";
import { FakeProvider } from "./helpers/fake-provider";

const TAG = `ZZWF${Date.now().toString(36).toUpperCase()}`;
const fake = new FakeProvider();
let admin: CurrentUser;
let catId: string;
let promoId = "";
const memberIds: string[] = [];
const eventIds: string[] = [];
let phoneSeq = Math.floor(Math.random() * 9_000_000) + 1_000_000;
const today = () => toBangkokDateKey(new Date());

beforeAll(async () => {
  const a = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
  admin = { id: a.id, email: a.email, name: a.name, role: a.role };
  _setProviderForTests(fake);
});

afterAll(async () => {
  _setProviderForTests(null);
  _setPromotionLoaderForTests(null);
  const ids = (await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
  const saleIds = (await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { saleId: true } })).map((s) => s.saleId);
  const payIds = (await db.payment.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((p) => p.id);
  const retIds = (await db.saleReturn.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })).map((r) => r.id);
  const batchIds = (await db.productBatch.findMany({ where: { productId: { in: ids } }, select: { id: true } })).map((b) => b.id);
  await db.webhookEvent.deleteMany({ where: { OR: [{ providerEventId: { in: eventIds } }, { paymentId: { in: payIds } }] } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...saleIds, ...payIds, ...ids, ...memberIds, ...batchIds, catId, promoId].filter(Boolean) } } });
  await db.notification.deleteMany({ where: { OR: [{ productId: { in: ids } }, { dedupeKey: { in: saleIds.map((s) => `PAYMENT_REVIEW:${s}`) } }] } });
  await db.pointTransaction.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.stockMovement.deleteMany({ where: { OR: [{ productId: { in: ids } }, { returnId: { in: retIds } }] } });
  await db.saleReturn.deleteMany({ where: { id: { in: retIds } } });
  await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
  await db.sale.deleteMany({ where: { id: { in: saleIds } } });
  await db.member.deleteMany({ where: { id: { in: memberIds } } });
  if (promoId) await db.promotion.deleteMany({ where: { id: promoId } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await db.$disconnect();
});

describe("กระบวนการครบวงจร: ตั้งสินค้า → โปรโมชั่น → สมาชิก → ขายเงินสด+QR → คืนสินค้า → ปรับสต็อก → รายงาน", () => {
  it("ทุกขั้นสอดคล้องกัน (ยอด สต็อก แต้ม รายงาน แจ้งเตือน audit)", async () => {
    // 1) ตั้งค่าสินค้า
    catId = (await createCategory(admin, { name: `${TAG} หมวด`, description: null })).id;
    const mk = async (suffix: string, price: string, cost: string, qty: number, min: number) =>
      (await createProduct(admin, createProductSchema.parse({ sku: `${TAG}-${suffix}`, barcode: "", name: `${TAG} สินค้า ${suffix}`, categoryId: catId, costPrice: cost, price, unit: "ชิ้น", minStock: min, initialQty: qty, initialExpiry: "" }))).id;
    const pA = await mk("A", "100", "60", 10, 3);
    const pB = await mk("B", "40", "25", 6, 5);
    const stock = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stockQty;

    // 2) โปรโมชั่น: สินค้า A ลด 10% (ใช้เฉพาะโปรนี้ในเทสต์)
    promoId = (await createPromotion(admin, { name: `${TAG} A ลด 10%`, scope: "PRODUCT", discountType: "PERCENT", value: "10", productId: pA, categoryId: null, minPurchase: null, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 86_400_000) })).id;
    _setPromotionLoaderForTests(async (client, at) => (await client.promotion.findMany({ where: { id: promoId, isActive: true, startsAt: { lte: at }, endsAt: { gt: at } } })).map(toRule));

    // 3) สมาชิก
    const memberId = (await createMember(admin, { name: `${TAG} สมาชิก`, phone: `09${String(phoneSeq++).padStart(8, "0")}`, email: null })).id;
    memberIds.push(memberId);

    const before = (await salesReport({ from: today(), to: today() })).totals;

    // 4) ขายเงินสด: A×2 (200→180) + B×1 (40) = 220 → 8 แต้ม (floor(220/25))
    const cash = await checkoutCash(admin, { idempotencyKey: randomUUID(), items: [{ productId: pA, quantity: 2 }, { productId: pB, quantity: 1 }], amountPaid: "300", memberId, expectedTotal: "220.00" });
    expect(cash).toMatchObject({ total: "220.00", change: "80.00", pointsEarned: 8 });

    // 5) ขาย QR: B×2 = 80 บาท → ยังไม่ตัดสต็อก/ไม่ได้แต้มจนกว่า Provider ยืนยัน
    const qr = await startQrPayment(admin, { idempotencyKey: randomUUID(), items: [{ productId: pB, quantity: 2 }], memberId, expectedTotal: "80.00" });
    expect(await stock(pB)).toBe(5);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).points).toBe(8);
    const charge = (await db.payment.findUniqueOrThrow({ where: { saleId: qr.saleId } })).providerChargeId!;
    fake.pay(charge);
    const evId = `evnt_test_${randomUUID().slice(0, 8)}`;
    eventIds.push(evId);
    expect((await handleProviderWebhook(JSON.stringify({ object: "event", id: evId, key: "charge.complete", data: { object: "charge", id: charge } }), new Headers())).body.outcome).toBe("CONFIRMED");
    expect(await stock(pB)).toBe(3);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).points).toBe(8 + 3); // floor(80/25)=3

    // 6) คืนสินค้า A 1 ชิ้นของบิลเงินสด (net 90) → คืน 90, หักแต้ม floor(8×90/220)=3
    const aItem = await db.saleItem.findFirstOrThrow({ where: { saleId: cash.saleId, productId: pA } });
    const ret = await returnSale(admin, { saleId: cash.saleId, items: [{ saleItemId: aItem.id, quantity: 1, restock: true }], reason: "ทดสอบกระบวนการ", refundNote: null, idempotencyKey: randomUUID() });
    expect(ret).toMatchObject({ refundTotal: "90.00", pointsReversed: 3, saleStatus: "PARTIALLY_RETURNED" });
    expect(await stock(pA)).toBe(9);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).points).toBe(11 - 3);

    // 7) ปรับสต็อก B ลงเหลือ 1 (ต่ำกว่าขั้นต่ำ 5) → ต้องมีแจ้งเตือนใกล้หมด + audit
    const bBatch = await db.productBatch.findFirstOrThrow({ where: { productId: pB, remainingQty: { gt: 0 } } });
    await adjustStock(admin, { batchId: bBatch.id, mode: "SET", qty: 1, reason: "นับสต็อกใหม่ (ทดสอบ)" });
    await syncNotifications();
    expect((await listNotifications(false)).some((n) => n.type === "LOW_STOCK" && n.message.includes(`${TAG}-B`))).toBe(true);

    // 8) รายงานวันนี้เพิ่มขึ้นตรงกับที่ขาย/คืน (เทียบส่วนต่างก่อน-หลัง เพราะวันนี้อาจมีข้อมูลจริงของผู้ใช้)
    const after = (await salesReport({ from: today(), to: today() })).totals;
    const diff = (k: "bills" | "gross" | "refunds" | "net") => Number(after[k]) - Number(before[k]);
    expect(diff("bills")).toBe(2);
    expect(diff("gross")).toBeCloseTo(300, 2); // 220 + 80
    expect(diff("refunds")).toBeCloseTo(90, 2);
    expect(diff("net")).toBeCloseTo(210, 2);
    // กำไร: เงินสด (180−120)+(40−25)=75; QR 80−50=30; คืน A (ทุนล็อต 60) 90−60=30 → 75+30−30 = 75
    expect(Number(after.profit) - Number(before.profit)).toBeCloseTo(75, 2);

    // 9) invariants รวม
    const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(drift[0].n)).toBe(0);
    const pts = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Member" m WHERE m.points <> COALESCE((SELECT SUM(points) FROM "PointTransaction" t WHERE t."memberId"=m.id),0)`;
    expect(Number(pts[0].n)).toBe(0);
    const net = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Sale" s WHERE s.status IN ('COMPLETED','PARTIALLY_RETURNED') AND s.total <> (SELECT COALESCE(SUM("netTotal"),0) FROM "SaleItem" i WHERE i."saleId"=s.id)`;
    expect(Number(net[0].n)).toBe(0);

    // 10) Audit ครบทุกการกระทำของผู้ดูแล
    const actions = (await db.auditLog.findMany({ where: { OR: [{ entityId: { in: [catId, pA, pB, promoId, memberId, cash.saleId, bBatch.id] } }] }, select: { action: true } })).map((a) => a.action);
    for (const want of ["CATEGORY_CREATE", "PRODUCT_CREATE", "PROMOTION_CREATE", "MEMBER_CREATE", "SALE_RETURN", "STOCK_ADJUST"]) expect(actions, want).toContain(want);
  }, 60_000);
});

describe("ข้อมูลสาธิต (สร้างผ่านระบบจริง)", () => {
  it("ปฏิเสธถ้าไม่ยืนยันด้วย ALLOW_DEMO_SEED", async () => {
    const prev = process.env.ALLOW_DEMO_SEED;
    delete process.env.ALLOW_DEMO_SEED;
    try { await expect(generateDemoSales({ days: 1 })).rejects.toThrow("ALLOW_DEMO_SEED"); } finally { if (prev !== undefined) process.env.ALLOW_DEMO_SEED = prev; }
  });

  it("สร้างยอดขายย้อนหลัง: เวลา/เลขใบเสร็จ/ประวัติสต็อก/เงินทอนถูกต้อง, รายงานตรงกับบิลที่สร้าง, ไม่มีบิลในอนาคต", async () => {
    _setPromotionLoaderForTests(async () => []);
    const cat = (await db.category.findFirstOrThrow({ where: { name: { startsWith: TAG } } })).id;
    const prods = await Promise.all(["D1", "D2", "D3", "D4", "D5", "D6"].map((s, i) => db.product.create({ data: { sku: `${TAG}-${s}`, name: `${TAG} เดโม ${s}`, categoryId: cat, costPrice: 10 + i, price: 20 + i * 5 } })));
    const m = await createMember(admin, { name: `${TAG} สมาชิกเดโม`, phone: `09${String(phoneSeq++).padStart(8, "0")}`, email: null });
    memberIds.push(m.id);

    const r = await generateDemoSales({ days: 3, billsPerDay: [4, 6], productIds: prods.map((p) => p.id), memberIds: [m.id], returns: 2, seed: 7, allow: true });
    expect(r.sales).toBeGreaterThan(5);
    expect(r.returns).toBeLessThanOrEqual(2);

    const sales = await db.sale.findMany({ where: { id: { in: r.saleIds } }, include: { items: true } });
    const now = Date.now();
    for (const s of sales) {
      expect(s.status === "COMPLETED" || s.status === "PARTIALLY_RETURNED" || s.status === "FULLY_RETURNED").toBe(true);
      expect(s.createdAt.getTime()).toBeLessThanOrEqual(now);
      expect(s.receiptNo!.slice(3, 11)).toBe(toBangkokDateKey(s.createdAt).replaceAll("-", "")); // วันที่ในเลขใบเสร็จ = วันที่ขาย (เวลาไทย)
      expect(s.amountPaid.greaterThanOrEqualTo(s.total)).toBe(true);
      expect(s.amountPaid.sub(s.total).toFixed(2)).toBe(s.changeAmount.toFixed(2));
    }
    const mv = await db.stockMovement.findMany({ where: { saleId: { in: r.saleIds }, type: "SALE" }, select: { createdAt: true, saleId: true } });
    const byId = new Map(sales.map((s) => [s.id, s.createdAt.getTime()]));
    expect(mv.every((x) => byId.get(x.saleId!) === x.createdAt.getTime())).toBe(true);

    // รายงานของ 4 วันนี้ต้องมีอย่างน้อยยอดของบิลที่สร้าง (ผ่านเส้นทาง SQL) และกราฟไม่ว่าง
    const from = toBangkokDateKey(new Date(now - 3 * 86_400_000));
    const rep = await salesReport({ from, to: today() });
    expect(rep.totals.bills).toBeGreaterThanOrEqual(r.sales);
    expect(Number(rep.totals.gross)).toBeGreaterThanOrEqual(sales.reduce((a, s) => a + Number(s.total), 0) - 0.01);

    const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(drift[0].n)).toBe(0);
  }, 120_000);
});

describe("ตั้งค่า", () => {
  it("validator ปฏิเสธค่าที่ผิด; บันทึกเฉพาะที่เปลี่ยนพร้อม audit; ค่าเดิมไม่สร้าง audit; คืนค่าเดิมเมื่อจบ", async () => {
    const base = await getSettings();
    const ok = { ...base, points_per_baht: String(base.points_per_baht), near_expiry_days: String(base.near_expiry_days), qr_expire_minutes: String(base.qr_expire_minutes) };
    expect(settingsSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ store_name: "  " }, { points_per_baht: "0" }, { points_per_baht: "1.5" }, { near_expiry_days: "400" }, { qr_expire_minutes: "1" }, { qr_expire_minutes: "abc" }]) {
      expect(settingsSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    const auditBefore = await db.auditLog.count({ where: { action: "SETTINGS_UPDATE" } });
    expect((await updateSettings(admin, { ...base })).changed).toBe(0);
    expect(await db.auditLog.count({ where: { action: "SETTINGS_UPDATE" } })).toBe(auditBefore);
    try {
      expect((await updateSettings(admin, { ...base, qr_expire_minutes: base.qr_expire_minutes === 15 ? 16 : 15 })).changed).toBe(1);
      expect(await db.auditLog.count({ where: { action: "SETTINGS_UPDATE" } })).toBe(auditBefore + 1);
    } finally {
      await updateSettings(admin, { ...base });
      await db.auditLog.deleteMany({ where: { action: "SETTINGS_UPDATE", userId: admin.id, createdAt: { gte: new Date(Date.now() - 120_000) } } });
    }
    expect(await getSettings()).toEqual(base);
  });
});
