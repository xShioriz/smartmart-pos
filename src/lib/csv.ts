// สร้างไฟล์ CSV สำหรับเปิดใน Excel: UTF-8 + BOM (ภาษาไทยไม่เพี้ยน), ขึ้นบรรทัดด้วย CRLF
// ป้องกัน CSV/formula injection: ข้อความที่ขึ้นต้นด้วย = + - @ หรือ tab/CR จะถูกใส่ ' นำหน้า (ชื่อสินค้ามาจากผู้ใช้จึงไม่ปลอดภัยถ้าไม่ทำ)
// ตัวเลข: ส่งเป็น { num: "123.40" } เพื่อคงทศนิยมตามที่คำนวณไว้และไม่ถูกมองเป็นข้อความ
export type CsvCell = string | number | { num: string } | null | undefined;

const NUM = /^-?\d+(\.\d+)?$/;

export function csvCell(c: CsvCell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") {
    if (!Number.isFinite(c)) throw new Error("ตัวเลขไม่ถูกต้อง");
    return String(c);
  }
  if (typeof c === "object") {
    if (!NUM.test(c.num)) throw new Error("ตัวเลขไม่ถูกต้อง");
    return c.num;
  }
  let s = c;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
