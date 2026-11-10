import { describe, expect, it } from "vitest";
import { resolveDashboardRange } from "../dashboard";

const TODAY = "2026-11-10";

describe("resolveDashboardRange", () => {
  it("ไม่มีพารามิเตอร์: 7 วันล่าสุด", () => {
    const r = resolveDashboardRange({}, TODAY);
    expect(r).toEqual({ range: { from: "2026-11-04", to: "2026-11-10" }, preset: 7, invalid: false });
  });

  it("range=30: 30 วันล่าสุด; ค่าอื่นตกเป็น 7", () => {
    expect(resolveDashboardRange({ range: "30" }, TODAY).range).toEqual({ from: "2026-10-12", to: "2026-11-10" });
    expect(resolveDashboardRange({ range: "999" }, TODAY).preset).toBe(7);
  });

  it("ช่วงที่เลือกเองถูกต้อง: ใช้ตามนั้นและไม่มี preset", () => {
    const r = resolveDashboardRange({ from: "2026-09-01", to: "2026-09-30" }, TODAY);
    expect(r).toEqual({ range: { from: "2026-09-01", to: "2026-09-30" }, preset: null, invalid: false });
  });

  it("วันเดียว (from = to = วันนี้) ใช้ได้", () => {
    expect(resolveDashboardRange({ from: TODAY, to: TODAY }, TODAY).invalid).toBe(false);
  });

  it.each([
    ["from หลัง to", { from: "2026-10-10", to: "2026-10-01" }],
    ["วันในอนาคต", { from: "2026-11-01", to: "2026-11-11" }],
    ["วันที่ไม่มีจริง", { from: "2026-02-30", to: "2026-03-05" }],
    ["รูปแบบผิด", { from: "10/10/2026", to: "2026-10-12" }],
    ["ส่งมาแค่ด้านเดียว", { from: "2026-10-01" }],
    ["เกิน 366 วัน", { from: "2025-01-01", to: "2026-11-10" }],
  ])("ช่วงใช้ไม่ได้ (%s): กลับเป็น 7 วัน และ invalid", (_n, input) => {
    const r = resolveDashboardRange(input, TODAY);
    expect(r.invalid).toBe(true);
    expect(r.preset).toBe(7);
    expect(r.range).toEqual({ from: "2026-11-04", to: "2026-11-10" });
  });
});
