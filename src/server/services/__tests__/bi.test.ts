// Unit test (ไม่ใช้ DB): สถิติและกฎของ Smart BI
import { describe, expect, it } from "vitest";
import { buildInsights, compareDays, daysOfCover, linearRegression, restockSuggestions, trendOf, type BiData } from "@/server/services/bi";
import type { DailyRow } from "@/server/services/reports";

describe("linearRegression", () => {
  it("เส้นตรงสมบูรณ์ y = 2x + 1 → slope 2, intercept 1", () => {
    const r = linearRegression([1, 3, 5, 7, 9]);
    expect(r.slope).toBeCloseTo(2, 10);
    expect(r.intercept).toBeCloseTo(1, 10);
  });
  it("ค่าคงที่ → slope 0; ข้อมูลน้อยกว่า 2 จุด → slope 0", () => {
    expect(linearRegression([5, 5, 5, 5]).slope).toBe(0);
    expect(linearRegression([]).slope).toBe(0);
    expect(linearRegression([9]).slope).toBe(0);
  });
});

describe("trendOf", () => {
  it("เพิ่มขึ้น/ลดลง/ทรงตัวตามเกณฑ์ ±5%", () => {
    expect(trendOf([100, 120, 140, 160, 180, 200, 220]).direction).toBe("UP");
    expect(trendOf([220, 200, 180, 160, 140, 120, 100]).direction).toBe("DOWN");
    expect(trendOf([100, 101, 99, 100, 102, 100, 99]).direction).toBe("FLAT");
  });
  it("เปลี่ยนแปลง% = slope × (n−1) ÷ ค่าเฉลี่ย (เช่น 100→220 เส้นตรง ค่าเฉลี่ย 160 → +75%)", () => {
    const t = trendOf([100, 120, 140, 160, 180, 200, 220]);
    expect(t.changePct).toBeCloseTo(75, 5);
    expect(t.mean).toBeCloseTo(160, 5);
  });
  it("มียอดขายน้อยกว่า 3 วัน หรือไม่มียอดเลย → ข้อมูลไม่พอ (ไม่เดา)", () => {
    expect(trendOf([0, 0, 0, 0, 50, 0, 80]).direction).toBe("INSUFFICIENT");
    expect(trendOf([0, 0, 0, 0, 0, 0, 0]).direction).toBe("INSUFFICIENT");
    expect(trendOf([]).direction).toBe("INSUFFICIENT");
  });
  it("วันที่ไม่มียอดขายนับเป็น 0 ในสถิติ (ไม่ถูกตัดทิ้ง)", () => {
    const t = trendOf([0, 100, 0, 100, 0, 100, 100]);
    expect(t.daysWithSales).toBe(4);
    expect(t.mean).toBeCloseTo(400 / 7, 8);
  });
});

describe("compareDays / daysOfCover", () => {
  it("เปรียบเทียบวัน: คิด % ได้เมื่อเมื่อวาน > 0 เท่านั้น", () => {
    expect(compareDays(150, 100)).toBeCloseTo(50, 10);
    expect(compareDays(50, 100)).toBeCloseTo(-50, 10);
    expect(compareDays(100, 0)).toBeNull();
    expect(compareDays(0, 0)).toBeNull();
  });
  it("วันที่สต็อกพอขาย: สต็อก ÷ เฉลี่ย/วัน; ไม่มียอดขาย = null", () => {
    expect(daysOfCover(30, 5)).toBe(6);
    expect(daysOfCover(30, 0)).toBeNull();
  });
});

describe("restockSuggestions", () => {
  const p = (name: string, stock: number, minStock: number, avgDaily: number) => ({ name, sku: name, stock, minStock, avgDaily });
  it("เตือนเมื่อพอขายน้อยกว่า 7 วัน หรือถึงขั้นต่ำ; เรียงจากเร่งด่วนสุด; ไม่เตือนของที่พอ", () => {
    const r = restockSuggestions([p("พอ", 100, 5, 2), p("ใกล้หมด", 10, 5, 3), p("ต่ำกว่าขั้นต่ำ", 4, 5, 0), p("แทบหมด", 3, 1, 3)]);
    expect(r.map((x) => x.name)).toEqual(["แทบหมด", "ใกล้หมด", "ต่ำกว่าขั้นต่ำ"]); // cover 1, 3.3, ∞(null)
  });
  it("จำนวนแนะนำ = เฉลี่ย × 14 − สต็อก (ปัดขึ้น, ไม่ติดลบ)", () => {
    const [x] = restockSuggestions([p("A", 10, 0, 3)]); // cover 3.33 → ต้องการ 42 → เพิ่ม 32
    expect(x.suggest).toBe(32);
    const [y] = restockSuggestions([p("B", 5, 5, 0)]); // ถึงขั้นต่ำแต่ไม่มียอดขาย → แนะนำ 0
    expect(y.suggest).toBe(0);
  });
  it("ขอบเขต: พอขาย 7 วันพอดีไม่เตือน; สต็อก = ขั้นต่ำเตือน", () => {
    expect(restockSuggestions([p("พอดี7", 14, 0, 2)])).toHaveLength(0);
    expect(restockSuggestions([p("เท่าขั้นต่ำ", 5, 5, 0.1)])).toHaveLength(1);
  });
});

describe("buildInsights", () => {
  const row = (day: string, net: number): DailyRow => ({ day, bills: net > 0 ? 1 : 0, gross: String(net), refunds: "0", net: String(net), profit: "0", cash: String(net), qr: "0" });
  const base = (nets: number[]): BiData => ({
    today: "2026-11-07",
    series7: nets.map((n, i) => row(`2026-11-0${i + 1}`, n)),
    top7: [], stock: [], slow: [], expiring: { units: 0, costValue: "0.00", names: [] }, nearDays: 30,
  });

  it("ทุก insight มีสูตร/เกณฑ์กำกับ และไม่มีข้อมูล → ไม่ error", () => {
    const list = buildInsights(base([0, 0, 0, 0, 0, 0, 0]));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((i) => i.formula.length > 10 && i.title && i.detail)).toBe(true);
    expect(list.find((i) => i.id === "trend")!.title).toContain("ข้อมูลยังไม่พอ");
  });
  it("วันนี้สูงกว่าเมื่อวาน → good + แสดง % ; ต่ำกว่า → warn", () => {
    expect(buildInsights(base([100, 100, 100, 100, 100, 100, 150])).find((i) => i.id === "day-compare")).toMatchObject({ severity: "good" });
    const down = buildInsights(base([100, 100, 100, 100, 100, 200, 100])).find((i) => i.id === "day-compare")!;
    expect(down.severity).toBe("warn");
    expect(down.title).toContain("-50.0%");
  });
  it("เมื่อวานไม่มียอดขาย → ไม่คิด % (ไม่หารศูนย์)", () => {
    const i = buildInsights(base([100, 100, 100, 100, 100, 0, 80])).find((x) => x.id === "day-compare")!;
    expect(i.title).not.toContain("%");
    expect(i.detail).toContain("เปรียบเทียบเป็น %");
  });
  it("แสดงรายการสั่งเพิ่ม/ขายช้า/ใกล้หมดอายุเมื่อมีข้อมูล และซ่อนเมื่อไม่มี", () => {
    const d = base([100, 100, 100, 100, 100, 100, 100]);
    expect(buildInsights(d).map((i) => i.id)).not.toContain("restock");
    d.stock = [{ name: "สินค้า ก", sku: "A", stock: 2, minStock: 1, avgDaily: 2 }];
    d.slow = [{ name: "สินค้า ข", sku: "B", stock: 9 }];
    d.expiring = { units: 12, costValue: "480.00", names: ["สินค้า ค — 12 ชิ้น (หมดอายุ 2026-11-20)"] };
    const ids = buildInsights(d).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["restock", "slow", "expiring"]));
    expect(buildInsights(d).find((i) => i.id === "expiring")!.title).toContain("12 ชิ้น");
  });
});
