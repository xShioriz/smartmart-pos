// Unit test (ไม่ใช้ DB): กติกาโปรโมชั่น + การกระจายส่วนลด + invariants ด้วย property test
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { allocateSatang, calculateCart, type PromoRule } from "@/server/services/pricing";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const NOW = new Date("2026-11-07T05:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let seq = 0;
const promo = (o: Partial<PromoRule> & Pick<PromoRule, "scope" | "discountType" | "value">): PromoRule => ({
  id: `p${String(++seq).padStart(4, "0")}`, name: `โปร ${seq}`, productId: null, categoryId: null, minPurchase: null,
  startsAt: day(-1), endsAt: day(1), isActive: true, ...o,
});
const line = (productId: string, unitPrice: string, quantity: number, categoryId = "c1") => ({ productId, categoryId, unitPrice, quantity });
const sum = (xs: Prisma.Decimal[]) => xs.reduce((s, x) => s.add(x), D(0));

describe("ไม่มีโปรโมชั่น", () => {
  it("ยอดรวม = Σ ราคา×จำนวน และไม่มีส่วนลด", () => {
    const c = calculateCart([line("a", "15.50", 3), line("b", "7.25", 4)]);
    expect(c.subtotal.toFixed(2)).toBe("75.50");
    expect([c.discountTotal.toFixed(2), c.total.toFixed(2)]).toEqual(["0.00", "75.50"]);
    expect(c.billPromotion).toBeNull();
  });
});

describe("โปรโมชั่นรายการ", () => {
  it("PERCENT ของยอดบรรทัด, FIXED ต่อหน่วย", () => {
    const c = calculateCart(
      [line("a", "100", 2), line("b", "20", 3)],
      [promo({ scope: "PRODUCT", discountType: "PERCENT", value: 10, productId: "a" }), promo({ scope: "PRODUCT", discountType: "FIXED", value: 2, productId: "b" })],
      NOW,
    );
    expect(c.lines.map((l) => l.itemDiscount.toFixed(2))).toEqual(["20.00", "6.00"]);
    expect(c.total.toFixed(2)).toBe("234.00"); // 200+60 - 26
  });
  it("FIXED ที่มากกว่าราคาต่อหน่วย → ลดได้ไม่เกินยอดบรรทัด (ราคาไม่ติดลบ)", () => {
    const c = calculateCart([line("a", "5", 3)], [promo({ scope: "PRODUCT", discountType: "FIXED", value: 50, productId: "a" })], NOW);
    expect(c.lines[0].netTotal.toFixed(2)).toBe("0.00");
    expect(c.total.toFixed(2)).toBe("0.00");
  });
  it("โปรสินค้า + โปรหมวดซ้อนกันไม่ได้: เลือกอันที่ลดมากที่สุดอันเดียว", () => {
    const small = promo({ scope: "CATEGORY", discountType: "PERCENT", value: 5, categoryId: "c1" });
    const big = promo({ scope: "PRODUCT", discountType: "PERCENT", value: 20, productId: "a" });
    const c = calculateCart([line("a", "100", 1)], [small, big], NOW);
    expect(c.lines[0].itemDiscount.toFixed(2)).toBe("20.00");
    expect(c.lines[0].promotion?.id).toBe(big.id);
  });
  it("ลดเท่ากัน → เลือก id น้อยกว่า (ผลคงที่ ไม่ขึ้นกับลำดับ)", () => {
    const p1 = promo({ scope: "PRODUCT", discountType: "FIXED", value: 10, productId: "a" });
    const p2 = promo({ scope: "CATEGORY", discountType: "PERCENT", value: 10, categoryId: "c1" });
    expect(calculateCart([line("a", "100", 1)], [p2, p1], NOW).lines[0].promotion?.id).toBe(p1.id);
    expect(calculateCart([line("a", "100", 1)], [p1, p2], NOW).lines[0].promotion?.id).toBe(p1.id);
  });
  it("โปรหมวดใช้กับสินค้าในหมวดเท่านั้น", () => {
    const c = calculateCart([line("a", "100", 1, "c1"), line("b", "100", 1, "c2")], [promo({ scope: "CATEGORY", discountType: "PERCENT", value: 10, categoryId: "c1" })], NOW);
    expect(c.lines.map((l) => l.itemDiscount.toFixed(2))).toEqual(["10.00", "0.00"]);
  });
  it("ทศนิยมปัดแบบ half-up 2 ตำแหน่ง", () => {
    const c = calculateCart([line("a", "10.05", 1)], [promo({ scope: "PRODUCT", discountType: "PERCENT", value: 10, productId: "a" })], NOW);
    expect(c.lines[0].itemDiscount.toFixed(2)).toBe("1.01"); // 1.005 → 1.01
    expect(c.total.toFixed(2)).toBe("9.04");
  });
});

describe("ช่วงเวลา/สถานะของโปรโมชั่น", () => {
  const p = (o: Partial<PromoRule>) => promo({ scope: "PRODUCT", discountType: "PERCENT", value: 10, productId: "a", ...o });
  const disc = (pr: PromoRule, at = NOW) => calculateCart([line("a", "100", 1)], [pr], at).discountTotal.toFixed(2);
  it("เริ่มแล้วใช้ได้ (startsAt รวมขอบ) / ยังไม่เริ่มใช้ไม่ได้", () => {
    expect(disc(p({ startsAt: NOW, endsAt: day(1) }))).toBe("10.00");
    expect(disc(p({ startsAt: day(1), endsAt: day(2) }))).toBe("0.00");
  });
  it("endsAt ไม่รวมขอบ / หมดอายุแล้วใช้ไม่ได้ / ปิดใช้งานใช้ไม่ได้", () => {
    expect(disc(p({ startsAt: day(-1), endsAt: NOW }))).toBe("0.00");
    expect(disc(p({ startsAt: day(-3), endsAt: day(-1) }))).toBe("0.00");
    expect(disc(p({ isActive: false }))).toBe("0.00");
  });
});

describe("โปรโมชั่นทั้งบิล", () => {
  const bill = (o: Partial<PromoRule> = {}) => promo({ scope: "BILL", discountType: "FIXED", value: 20, minPurchase: 300, ...o });
  it("ต้องถึงยอดขั้นต่ำ (คิดจากยอดหลังลดรายการ)", () => {
    const item = promo({ scope: "PRODUCT", discountType: "PERCENT", value: 10, productId: "a" });
    const low = calculateCart([line("a", "310", 1)], [item, bill()], NOW); // หลังลดรายการ 279 < 300
    expect(low.billPromotion).toBeNull();
    expect(low.total.toFixed(2)).toBe("279.00");
    const ok = calculateCart([line("a", "340", 1)], [item, bill()], NOW); // 306 ≥ 300
    expect(ok.billDiscount.toFixed(2)).toBe("20.00");
    expect(ok.total.toFixed(2)).toBe("286.00");
  });
  it("ใช้ได้เพียงอันเดียว (อันที่ลดมากสุด) และ FIXED ไม่เกินยอดบิล", () => {
    const a = bill({ value: 20 });
    const b = bill({ discountType: "PERCENT", value: 10, minPurchase: null });
    const c = calculateCart([line("a", "400", 1)], [a, b], NOW);
    expect(c.billPromotion?.id).toBe(b.id);
    expect(c.billDiscount.toFixed(2)).toBe("40.00");
    const tiny = calculateCart([line("a", "30", 1)], [bill({ value: 500, minPurchase: null })], NOW);
    expect(tiny.total.toFixed(2)).toBe("0.00");
  });
  it("กระจายส่วนลดตามสัดส่วนและผลรวมเท่าส่วนลดทั้งบิลเป๊ะ (เศษสตางค์)", () => {
    // 3 บรรทัดเท่ากัน ลด 10 บาท → 3.34 / 3.33 / 3.33
    const c = calculateCart([line("a", "100", 1), line("b", "100", 1), line("c", "100", 1)], [bill({ value: 10, minPurchase: null })], NOW);
    expect(c.lines.map((l) => l.billShare.toFixed(2))).toEqual(["3.34", "3.33", "3.33"]);
    expect(sum(c.lines.map((l) => l.billShare)).toFixed(2)).toBe("10.00");
    expect(sum(c.lines.map((l) => l.netTotal)).toFixed(2)).toBe(c.total.toFixed(2));
  });
  it("บรรทัดที่ยอด 0 (ลดรายการหมดแล้ว) ไม่รับส่วนลดทั้งบิล", () => {
    const c = calculateCart([line("a", "10", 1), line("b", "400", 1)], [promo({ scope: "PRODUCT", discountType: "PERCENT", value: 100, productId: "a" }), bill({ value: 50, minPurchase: null })], NOW);
    expect(c.lines[0].billShare.toFixed(2)).toBe("0.00");
    expect(c.lines[1].billShare.toFixed(2)).toBe("50.00");
  });
});

describe("allocateSatang", () => {
  it("รวมเท่ากับยอดเสมอ ไม่เกินน้ำหนัก", () => {
    const w = [D(10000), D(10000), D(10000)]; // น้ำหนัก = ยอดบรรทัด (สตางค์) ซึ่งเป็นเพดานของส่วนที่ได้รับด้วย
    expect(allocateSatang(D(1000), w).map(String)).toEqual(["334", "333", "333"]);
    expect(allocateSatang(D(2), [D(1), D(1), D(1000)]).reduce((s, x) => s.add(x), D(0)).toString()).toBe("2");
    expect(allocateSatang(D(0), w).map(String)).toEqual(["0", "0", "0"]);
    expect(allocateSatang(D(5), [D(0), D(0)]).map(String)).toEqual(["0", "0"]);
  });
});

describe("property: invariants ของทุกตะกร้า/โปรสุ่ม (1,500 รอบ, seed คงที่)", () => {
  // PRNG แบบกำหนดผลได้ เพื่อให้เทสต์ทำซ้ำได้
  let s = 123456789;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const money = () => (int(1, 99999) / 100).toFixed(2);

  it("Σ net = total, total = subtotal − discount, ส่วนลดไม่ติดลบ/ไม่เกินยอด, Σ billShare = billDiscount", () => {
    for (let n = 0; n < 1500; n++) {
      const lines = Array.from({ length: int(1, 8) }, (_, i) => line(`p${i}`, money(), int(1, 12), `c${int(1, 3)}`));
      const promos: PromoRule[] = Array.from({ length: int(0, 6) }, () => {
        const scope = (["PRODUCT", "CATEGORY", "BILL"] as const)[int(0, 2)];
        const type = rnd() < 0.5 ? "PERCENT" : "FIXED";
        return promo({
          scope, discountType: type, value: type === "PERCENT" ? int(1, 100) : money(),
          productId: scope === "PRODUCT" ? `p${int(0, 7)}` : null, categoryId: scope === "CATEGORY" ? `c${int(1, 3)}` : null,
          minPurchase: scope === "BILL" && rnd() < 0.5 ? int(0, 800) : null,
        });
      });
      const c = calculateCart(lines, promos, NOW);
      const tag = `รอบ ${n}`;
      expect(sum(c.lines.map((l) => l.netTotal)).toFixed(2), tag).toBe(c.total.toFixed(2));
      expect(c.subtotal.sub(c.discountTotal).toFixed(2), tag).toBe(c.total.toFixed(2));
      expect(sum(c.lines.map((l) => l.billShare)).toFixed(2), tag).toBe(c.billDiscount.toFixed(2));
      expect(c.itemDiscountTotal.add(c.billDiscount).toFixed(2), tag).toBe(c.discountTotal.toFixed(2));
      for (const l of c.lines) {
        expect(l.itemDiscount.isNegative() || l.billShare.isNegative() || l.netTotal.isNegative(), tag).toBe(false);
        expect(l.netTotal.lessThanOrEqualTo(l.lineTotal), tag).toBe(true);
        expect(l.lineTotal.decimalPlaces() <= 2 && l.netTotal.decimalPlaces() <= 2 && l.billShare.decimalPlaces() <= 2, tag).toBe(true);
      }
      expect(c.total.isNegative(), tag).toBe(false);
      // สลับลำดับโปรโมชั่น/บรรทัด ต้องได้ผลเหมือนเดิม
      const shuffled = calculateCart([...lines].reverse(), [...promos].reverse(), NOW);
      expect(shuffled.total.toFixed(2), tag).toBe(c.total.toFixed(2));
    }
  });
});
