// เวลาทั้งระบบเก็บเป็น UTC; "วัน" ทางธุรกิจคำนวณด้วยเขตเวลา Asia/Bangkok (UTC+7, ไม่มี DST) เสมอ
export const BANGKOK_TZ = "Asia/Bangkok";
const OFFSET_MS = 7 * 60 * 60 * 1000;

/** คีย์วันที่แบบ yyyy-MM-dd ตามเวลาไทย */
export function toBangkokDateKey(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** จุดเริ่มต้นของวัน (00:00 เวลาไทย) ของวันที่ที่ d ตกอยู่ เป็น Date (UTC) */
export function startOfBangkokDay(d: Date): Date {
  const key = toBangkokDateKey(d);
  return new Date(`${key}T00:00:00+07:00`);
}

/** ขอบเขตครึ่งเปิด [start, end) ของวันตามคีย์ yyyy-MM-dd */
export function bangkokDayRange(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** วันนี้ตามเวลาไทยเป็น yyyy-MM-dd (ใช้กับ expiryDate: หมดอายุ = วันนี้ > expiryDate) */
export function todayBangkokKey(now: Date = new Date()): string {
  return toBangkokDateKey(now);
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    calendar: "gregory",
  }).format(d);
}

/** ISO (UTC) → "yyyy-MM-ddTHH:mm" ตามเวลาไทย สำหรับ <input type="datetime-local"> */
export function toBangkokInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
