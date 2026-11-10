import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildReorderList, type ReorderCandidate } from "../bi";

const cand = (o: Partial<ReorderCandidate> & { sku: string }): ReorderCandidate => ({
  name: o.sku, unit: "ชิ้น", category: "หมวด", stock: 100, minStock: 5, avgDaily: 0, costPrice: new Prisma.Decimal("10.00"), ...o,
});

describe("buildReorderList", () => {
  it("ไม่แนะนำสินค้าที่สต็อกพอ (เกิน 7 วันและสูงกว่าขั้นต่ำ)", () => {
    expect(buildReorderList([cand({ sku: "A", stock: 100, avgDaily: 5 })])).toEqual([]);
  });

  it("สินค้าที่หมดสต็อกและมียอดขายอยู่ในรายการ: ควรสั่ง = เฉลี่ย×14 − สต็อก", () => {
    const [r] = buildReorderList([cand({ sku: "OUT", stock: 0, minStock: 5, avgDaily: 3 })]);
    expect(r.suggest).toBe(42);
    expect(r.cover).toBe(0);
    expect(r.estCost).toBe("420.00"); // 42 × 10.00
    expect(r.costPrice).toBe("10.00");
  });

  it("เตือนเมื่อพอขายน้อยกว่า 7 วันแม้ยังสูงกว่าขั้นต่ำ", () => {
    const [r] = buildReorderList([cand({ sku: "SOON", stock: 20, minStock: 5, avgDaily: 4 })]); // 5 วัน
    expect(r.cover).toBe(5);
    expect(r.suggest).toBe(36); // 4×14 − 20
  });

  it("ต่ำกว่าขั้นต่ำแต่ไม่มียอดขาย: แนะนำเติมให้ถึง 2×ขั้นต่ำ (ไม่ให้จำนวนเป็นศูนย์)", () => {
    const [r] = buildReorderList([cand({ sku: "NOSALE", stock: 2, minStock: 10, avgDaily: 0 })]);
    expect(r.suggest).toBe(18);
    expect(r.cover).toBeNull();
  });

  it("ต่ำกว่าขั้นต่ำและไม่มียอดขายและขั้นต่ำ 0: จำนวนแนะนำไม่ติดลบ", () => {
    const list = buildReorderList([cand({ sku: "Z", stock: 0, minStock: 0, avgDaily: 0 })]);
    expect(list[0].suggest).toBe(0);
  });

  it("เรียงตามความเร่งด่วน: พอขายน้อยวันก่อน", () => {
    const list = buildReorderList([
      cand({ sku: "B", stock: 20, minStock: 5, avgDaily: 4 }), // 5 วัน
      cand({ sku: "A", stock: 0, minStock: 5, avgDaily: 2 }), // 0 วัน
      cand({ sku: "C", stock: 2, minStock: 10, avgDaily: 0 }), // ไม่มียอดขาย → ท้าย
    ]);
    expect(list.map((r) => r.sku)).toEqual(["A", "B", "C"]);
  });
});
