// Integration test: หมวดหมู่ + สินค้า + ล็อตเริ่มต้น (ต่อ DB dev จริง; ข้อมูลทดสอบขึ้นต้น ZZTEST และถูกลบเมื่อจบ)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { BusinessError } from "@/lib/result";
import type { CurrentUser } from "@/server/auth/guard";
import { createCategory, deleteCategory, updateCategory } from "@/server/services/categories";
import { createProduct, listProducts, setProductActive, updateProduct } from "@/server/services/products";
import { createProductSchema, updateProductSchema } from "@/lib/validators/product";

const TAG = `ZZTEST${Date.now().toString(36).toUpperCase()}`;
let actor: CurrentUser;
let catId: string;

const base = (over: Record<string, unknown> = {}) =>
  createProductSchema.parse({ sku: `${TAG}-A`, barcode: "", name: `${TAG} สินค้า`, categoryId: catId, costPrice: "10", price: "15.50", unit: "ชิ้น", minStock: 2, initialQty: 10, initialExpiry: "2030-01-31", ...over });

beforeAll(async () => {
  const u = await db.user.findUniqueOrThrow({ where: { email: "admin@smartmart.local" } });
  actor = { id: u.id, email: u.email, name: u.name, role: u.role };
  catId = (await createCategory(actor, { name: `${TAG} หมวด`, description: null })).id;
});

afterAll(async () => {
  const products = await db.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } });
  const ids = products.map((p) => p.id);
  await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await db.productBatch.deleteMany({ where: { productId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...ids, catId] } }] } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await db.$disconnect();
});

describe("validators", () => {
  it("ราคาทศนิยมเกิน 2 ตำแหน่งถูกปฏิเสธ", () => {
    expect(() => base({ price: "1.234" })).toThrow();
  });
  it("ราคา/สต็อก/ขั้นต่ำติดลบถูกปฏิเสธ", () => {
    expect(() => base({ price: "-1" })).toThrow();
    expect(() => base({ initialQty: -1 })).toThrow();
    expect(() => base({ minStock: -1 })).toThrow();
  });
  it("สต็อกทศนิยมถูกปฏิเสธ และวันหมดอายุผิดรูปแบบถูกปฏิเสธ", () => {
    expect(() => base({ initialQty: 1.5 })).toThrow();
    expect(() => base({ initialExpiry: "31/01/2030" })).toThrow();
  });
  it("barcode ว่าง → null และ SKU มีอักขระต้องห้ามถูกปฏิเสธ", () => {
    expect(base().barcode).toBeNull();
    expect(() => base({ sku: "A B" })).toThrow();
  });
  it("update schema ต้องมี id เป็น uuid", () => {
    expect(() => updateProductSchema.parse({ id: "x", sku: "A", name: "n", categoryId: catId, costPrice: "1", price: "1", unit: "u", minStock: 0 })).toThrow();
  });
});

describe("category", () => {
  it("ชื่อซ้ำถูกปฏิเสธ", async () => {
    await expect(createCategory(actor, { name: `${TAG} หมวด`, description: null })).rejects.toThrow(BusinessError);
  });
  it("แก้ไขชื่อได้ และบันทึก audit", async () => {
    const c = await createCategory(actor, { name: `${TAG} ชั่วคราว`, description: null });
    await updateCategory(actor, { id: c.id, name: `${TAG} ชั่วคราว2`, description: "x" });
    expect(await db.auditLog.count({ where: { entityId: c.id, action: "CATEGORY_UPDATE" } })).toBe(1);
    await deleteCategory(actor, c.id);
    expect(await db.category.findUnique({ where: { id: c.id } })).toBeNull();
    await db.auditLog.deleteMany({ where: { entityId: c.id } });
  });
});

describe("product + ล็อตเริ่มต้น", () => {
  let productId: string;

  it("สร้างสินค้า → มี batch, movement INITIAL, stockQty ตรงผลรวม batch", async () => {
    const r = await createProduct(actor, base());
    productId = r.id;
    const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { batches: true, stockMovements: true } });
    expect(p.stockQty).toBe(10);
    expect(p.batches).toHaveLength(1);
    expect(p.batches[0].remainingQty).toBe(10);
    expect(p.batches[0].expiryDate?.toISOString().slice(0, 10)).toBe("2030-01-31");
    expect(p.stockMovements).toHaveLength(1);
    expect(p.stockMovements[0]).toMatchObject({ type: "INITIAL", quantityChange: 10, balanceAfter: 10 });
    expect(p.price.toFixed(2)).toBe("15.50");
  });

  it("SKU ซ้ำ / barcode ซ้ำถูกปฏิเสธ และไม่มีข้อมูลค้าง", async () => {
    await expect(createProduct(actor, base({ name: "dup" }))).rejects.toThrow("SKU");
    await createProduct(actor, base({ sku: `${TAG}-B`, barcode: `${TAG}8850001`, initialQty: 0 }));
    await expect(createProduct(actor, base({ sku: `${TAG}-C`, barcode: `${TAG}8850001`, initialQty: 5 }))).rejects.toThrow("บาร์โค้ด");
    expect(await db.product.count({ where: { sku: `${TAG}-C` } })).toBe(0); // rollback ทั้งก้อน
    expect(await db.productBatch.count({ where: { product: { sku: `${TAG}-C` } } })).toBe(0);
  });

  it("สร้างโดยไม่ใส่ barcode ได้หลายตัว (NULL ซ้ำได้) และสต็อก 0 ไม่สร้าง batch", async () => {
    await createProduct(actor, base({ sku: `${TAG}-D`, initialQty: 0 }));
    await createProduct(actor, base({ sku: `${TAG}-E`, initialQty: 0 }));
    const p = await db.product.findUniqueOrThrow({ where: { sku: `${TAG}-D` }, include: { batches: true } });
    expect(p.stockQty).toBe(0);
    expect(p.batches).toHaveLength(0);
  });

  it("แก้ราคา → audit PRODUCT_PRICE_CHANGE ที่มี before/after และไม่แตะสต็อก", async () => {
    await updateProduct(actor, updateProductSchema.parse({ id: productId, sku: `${TAG}-A`, barcode: "", name: `${TAG} สินค้า`, categoryId: catId, costPrice: "10", price: "20", unit: "ชิ้น", minStock: 2 }));
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: productId, action: "PRODUCT_PRICE_CHANGE" } });
    expect((log.before as { price: string }).price).toBe("15.50");
    expect((log.after as { price: string }).price).toBe("20.00");
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(10);
  });

  it("แก้โดยไม่เปลี่ยนค่า → ไม่สร้าง audit เพิ่ม", async () => {
    const before = await db.auditLog.count({ where: { entityId: productId } });
    await updateProduct(actor, updateProductSchema.parse({ id: productId, sku: `${TAG}-A`, barcode: "", name: `${TAG} สินค้า`, categoryId: catId, costPrice: "10", price: "20", unit: "ชิ้น", minStock: 2 }));
    expect(await db.auditLog.count({ where: { entityId: productId } })).toBe(before);
  });

  it("ลบหมวดที่มีสินค้าไม่ได้", async () => {
    await expect(deleteCategory(actor, catId)).rejects.toThrow("มีสินค้า");
  });

  it("ค้นหาด้วย SKU/ชื่อ/barcode และกรองสถานะ", async () => {
    expect((await listProducts({ q: `${TAG}-a` })).items.map((i) => i.sku)).toContain(`${TAG}-A`);
    expect((await listProducts({ q: `${TAG}8850001` })).items).toHaveLength(1);
    await setProductActive(actor, { id: productId, isActive: false });
    expect((await listProducts({ q: TAG, status: "active" })).items.map((i) => i.sku)).not.toContain(`${TAG}-A`);
    expect((await listProducts({ q: TAG, status: "inactive" })).items.map((i) => i.sku)).toContain(`${TAG}-A`);
    // สินค้าที่ปิดแล้วยังอยู่ในฐานข้อมูล (ไม่ลบ)
    expect(await db.product.count({ where: { id: productId } })).toBe(1);
  });

  it("Σ batch = stockQty ทุกสินค้าในระบบ", async () => {
    const bad = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Product" p WHERE p."stockQty" <> COALESCE((SELECT SUM("remainingQty") FROM "ProductBatch" b WHERE b."productId"=p.id),0)`;
    expect(Number(bad[0].n)).toBe(0);
  });
});
