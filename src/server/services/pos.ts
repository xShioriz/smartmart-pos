import { db } from "@/server/db";
import { todayBangkokKey } from "@/lib/date";

export type PosProduct = {
  id: string; sku: string; barcode: string | null; name: string; categoryId: string; categoryName: string;
  price: string; unit: string; sellable: number;
};

/** สินค้าที่เปิดขายสำหรับหน้า POS — ราคาที่ส่งให้ client ใช้แสดงผลเท่านั้น (checkout คำนวณใหม่จาก DB เสมอ) */
export async function listPosProducts(): Promise<PosProduct[]> {
  const today = todayBangkokKey();
  const [products, sellable] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, include: { category: { select: { name: true } } }, orderBy: [{ name: "asc" }] }),
    db.$queryRaw<{ productId: string; qty: bigint }[]>`
      SELECT "productId", SUM("remainingQty")::bigint AS qty
      FROM "ProductBatch"
      WHERE "remainingQty" > 0 AND ("expiryDate" IS NULL OR "expiryDate" >= ${today}::date)
      GROUP BY "productId"`,
  ]);
  const qtyById = new Map(sellable.map((r) => [r.productId, Number(r.qty)]));
  return products.map((p) => ({
    id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, categoryId: p.categoryId, categoryName: p.category.name,
    price: p.price.toFixed(2), unit: p.unit, sellable: qtyById.get(p.id) ?? 0,
  }));
}
