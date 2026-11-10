import { describe, expect, it } from "vitest";
import { compareText, nextSort, parseSort, sortRows } from "@/lib/sort";
import { sortInventory, statusRank, type InventoryRow } from "@/server/services/inventory";

const KEYS = ["a", "b"] as const;

describe("parseSort / nextSort", () => {
  it("ค่าที่ไม่รู้จักตกกลับเป็นค่าเริ่มต้น", () => {
    expect(parseSort(KEYS, { sort: "evil; drop", dir: "desc" }, { key: "a", dir: "asc" })).toEqual({ key: "a", dir: "asc" });
    expect(parseSort(KEYS, {}, { key: "b", dir: "desc" })).toEqual({ key: "b", dir: "desc" });
  });
  it("อ่านคีย์ที่ถูกต้อง; dir แปลก ๆ = asc", () => {
    expect(parseSort(KEYS, { sort: "b", dir: "desc" }, { key: "a", dir: "asc" })).toEqual({ key: "b", dir: "desc" });
    expect(parseSort(KEYS, { sort: "b", dir: "zzz" }, { key: "a", dir: "asc" })).toEqual({ key: "b", dir: "asc" });
  });
  it("กดคอลัมน์เดิมสลับทิศ คอลัมน์ใหม่ใช้ทิศแรกที่กำหนด", () => {
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort({ key: "a", dir: "desc" }, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextSort({ key: "a", dir: "asc" }, "b", "desc")).toEqual({ key: "b", dir: "desc" });
  });
  it("เรียงภาษาไทยตามพจนานุกรม และเลขตามค่า", () => {
    expect(["ไข่", "กาแฟ", "ข้าว"].sort(compareText)).toEqual(["กาแฟ", "ข้าว", "ไข่"]);
    expect(["SKU10", "SKU9", "SKU1"].sort(compareText)).toEqual(["SKU1", "SKU9", "SKU10"]);
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "ข้าว", v: 5 as number | null },
    { n: "กาแฟ", v: null },
    { n: "ไข่", v: 20 },
    { n: "นม", v: 5 },
  ];
  const get = { n: (r: (typeof rows)[number]) => r.n, v: (r: (typeof rows)[number]) => r.v };
  const names = (r: typeof rows) => r.map((x) => x.n).join(",");

  it("ข้อความเรียงตามพจนานุกรมไทย", () => {
    expect(names(sortRows(rows, { key: "n", dir: "asc" }, get))).toBe("กาแฟ,ข้าว,ไข่,นม");
    expect(names(sortRows(rows, { key: "n", dir: "desc" }, get))).toBe("นม,ไข่,ข้าว,กาแฟ");
  });
  it("ตัวเลขเรียงตามค่า ค่าว่างอยู่ท้ายเสมอทั้งสองทิศ และค่าเท่ากันเรียงตาม tie", () => {
    expect(names(sortRows(rows, { key: "v", dir: "asc" }, get, (r) => r.n))).toBe("ข้าว,นม,ไข่,กาแฟ");
    expect(names(sortRows(rows, { key: "v", dir: "desc" }, get, (r) => r.n))).toBe("ไข่,ข้าว,นม,กาแฟ");
  });
  it("ไม่แก้อาร์เรย์เดิม", () => {
    const copy = [...rows];
    sortRows(rows, { key: "v", dir: "asc" }, get);
    expect(rows).toEqual(copy);
  });
});

const row = (o: Partial<InventoryRow>): InventoryRow => ({
  id: o.sku ?? "x", sku: "S", name: "n", categoryName: "c", unit: "ชิ้น", isActive: true,
  stockQty: 10, sellableQty: 10, minStock: 5, status: "OK", expiredQty: 0, nearExpiryQty: 0, nextExpiry: null, ...o,
});

describe("sortInventory", () => {
  const rows = [
    row({ sku: "A", name: "ข้าว", stockQty: 50, nextExpiry: "2027-01-01" }),
    row({ sku: "B", name: "กาแฟ", stockQty: 5, status: "LOW", nextExpiry: null }),
    row({ sku: "C", name: "ไข่", stockQty: 0, status: "OUT", nextExpiry: "2026-12-01" }),
    row({ sku: "D", name: "นม", stockQty: 20, nextExpiry: "2026-11-20", nearExpiryQty: 3 }),
  ];
  const skus = (r: InventoryRow[]) => r.map((x) => x.sku).join("");

  it("ชื่อ ก-ฮ และกลับด้าน", () => {
    expect(skus(sortInventory(rows, { key: "name", dir: "asc" }))).toBe("BACD"); // กาแฟ ข้าว ไข่ นม (พจนานุกรมไทยข้ามสระนำ ไ)
    expect(skus(sortInventory(rows, { key: "name", dir: "desc" }))).toBe("DCAB");
  });
  it("จำนวนคงเหลือ", () => {
    expect(skus(sortInventory(rows, { key: "stock", dir: "asc" }))).toBe("CBDA");
    expect(skus(sortInventory(rows, { key: "stock", dir: "desc" }))).toBe("ADBC");
  });
  it("วันหมดอายุ: ที่ว่างอยู่ท้ายเสมอทั้งสองทิศ", () => {
    expect(skus(sortInventory(rows, { key: "expiry", dir: "asc" }))).toBe("DCAB");
    expect(skus(sortInventory(rows, { key: "expiry", dir: "desc" }))).toBe("ACDB");
  });
  it("สถานะ: เร่งด่วนก่อน (หมด → ใกล้หมด → ใกล้หมดอายุ → ปกติ)", () => {
    expect(skus(sortInventory(rows, { key: "status", dir: "asc" }))).toBe("CBDA");
    expect(statusRank(rows[2])).toBeLessThan(statusRank(rows[1]));
  });
  it("ไม่แก้อาร์เรย์เดิม", () => {
    const copy = [...rows];
    sortInventory(rows, { key: "stock", dir: "asc" });
    expect(rows).toEqual(copy);
  });
});
