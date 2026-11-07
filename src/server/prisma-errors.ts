import { Prisma } from "@prisma/client";

/** P2002 (unique) — คืนรายชื่อฟิลด์ที่ซ้ำ หรือ null ถ้าไม่ใช่ข้อผิดพลาดนี้ */
export function uniqueViolationFields(e: unknown): string[] | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = e.meta?.target;
    return Array.isArray(target) ? target.map(String) : target ? [String(target)] : [];
  }
  return null;
}

/** P2003 (foreign key restrict) */
export function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}
