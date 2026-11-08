import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("ขึ้นต้นด้วย BOM และคั่นบรรทัดด้วย CRLF (เปิดใน Excel ภาษาไทยได้)", () => {
    const out = toCsv([["ก", "ข"], ["1", "2"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿ก,ข\r\n1,2\r\n");
  });

  it("ครอบเครื่องหมายคำพูดเมื่อมี , \" หรือขึ้นบรรทัดใหม่ และ escape \" เป็น \"\"", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("ธรรมดา")).toBe("ธรรมดา");
  });

  it("กัน formula injection: ข้อความที่ขึ้นต้นด้วย = + - @ tab CR ถูกใส่ ' นำหน้า", () => {
    for (const s of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).startsWith("'") || csvCell(s).startsWith('"\'')).toBe(true);
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("ปกติ=ไม่ขึ้นต้น")).toBe("ปกติ=ไม่ขึ้นต้น");
  });

  it("ตัวเลข: { num } คงทศนิยมและเลขติดลบไม่ถูกใส่ ' (ไม่ถูกมองเป็นข้อความ)", () => {
    expect(csvCell({ num: "123.40" })).toBe("123.40");
    expect(csvCell({ num: "-5.00" })).toBe("-5.00");
    expect(csvCell(7)).toBe("7");
    expect(csvCell(-7)).toBe("-7");
  });

  it("ตัวเลขที่ไม่ใช่เลข (เช่น สูตรที่แอบมาในช่อง num) ถูกปฏิเสธ", () => {
    expect(() => csvCell({ num: "=1+1" })).toThrow();
    expect(() => csvCell({ num: "1e5" })).toThrow();
    expect(() => csvCell(Number.NaN)).toThrow();
  });

  it("null/undefined เป็นช่องว่าง", () => {
    expect(toCsv([[null, undefined, "x"]])).toBe("﻿,,x\r\n");
  });
});
