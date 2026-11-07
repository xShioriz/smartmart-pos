export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** ข้อผิดพลาดทางธุรกิจที่แสดงให้ผู้ใช้เห็นได้ตรง ๆ */
export class BusinessError extends Error {}
