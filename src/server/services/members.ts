import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { BusinessError } from "@/lib/result";
import { thaiSortedPageIds } from "@/lib/sort";
import type { CurrentUser } from "@/server/auth/guard";
import { uniqueViolationFields } from "@/server/prisma-errors";
import { getSettingNumber } from "./settings";

type Tx = Prisma.TransactionClient;

export const MEMBER_PAGE_SIZE = 20;
export const normalizePhone = (v: string) => v.replace(/[\s-]/g, "");

/* ───────────── แต้มสะสม (Earn อย่างเดียวใน MVP) ───────────── */

/** แต้มที่จะได้จากยอดสุทธิ = floor(ยอด / บาทต่อแต้ม) — ใช้แสดงตัวอย่างในตะกร้า (ตัวจริงคำนวณใน awardPoints) */
export async function pointsFor(total: Prisma.Decimal.Value): Promise<number> {
  const per = await getSettingNumber("points_per_baht", 25);
  return per > 0 ? Math.floor(Number(total) / per) : 0;
}

/**
 * ให้แต้ม+สะสมยอดซื้อให้สมาชิกของบิลที่ปิดแล้ว (เรียกใน transaction เดียวกับการปิดบิล)
 * - อัปเดต Member แบบ atomic (increment) → ขายพร้อมกันของสมาชิกคนเดียวกันรวมแต้มถูก
 * - ไม่ให้ซ้ำ: ถ้า Sale.pointsEarned > 0 หรือมี EARN ของบิลนี้แล้ว จะไม่ทำอีก
 */
export async function awardPoints(tx: Tx, saleId: string, perBaht?: number): Promise<number> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, select: { memberId: true, total: true, pointsEarned: true } });
  if (!sale.memberId) return 0;
  const already = await tx.pointTransaction.count({ where: { saleId, type: "EARN" } });
  if (already > 0 || sale.pointsEarned > 0) return 0;
  const per = perBaht ?? (await getSettingNumber("points_per_baht", 25));
  const points = per > 0 ? Math.floor(Number(sale.total) / per) : 0;
  const member = await tx.member.update({
    where: { id: sale.memberId },
    data: { totalSpent: { increment: sale.total }, ...(points > 0 && { points: { increment: points } }) },
    select: { points: true },
  });
  if (points > 0) {
    await tx.pointTransaction.create({
      data: { memberId: sale.memberId, saleId, type: "EARN", points, balanceAfter: member.points, note: `ซื้อสินค้า ${sale.total.toFixed(2)} บาท` },
    });
    await tx.sale.update({ where: { id: saleId }, data: { pointsEarned: points } });
  }
  return points;
}

/* ───────────── จัดการสมาชิก ───────────── */

const memberSelect = { id: true, code: true, name: true, phone: true, email: true, points: true, totalSpent: true, isActive: true, createdAt: true } as const;

export const MEMBER_SORT_KEYS = ["code", "name", "phone", "points", "spent", "status"] as const;
export type MemberSortKey = (typeof MEMBER_SORT_KEYS)[number];

function memberOrder(s: { key: MemberSortKey; dir: "asc" | "desc" }): Prisma.MemberOrderByWithRelationInput[] {
  const d = s.dir;
  switch (s.key) {
    case "name": return [{ name: d }, { code: "asc" }];
    case "phone": return [{ phone: d }, { code: "asc" }];
    case "points": return [{ points: d }, { code: "asc" }];
    case "spent": return [{ totalSpent: d }, { code: "asc" }];
    case "status": return [{ isActive: d === "asc" ? "desc" : "asc" }, { code: "asc" }]; // asc = ใช้งานก่อน
    default: return [{ code: d }];
  }
}

export async function listMembers(opts: { q?: string; page?: number; sort?: { key: MemberSortKey; dir: "asc" | "desc" } }) {
  const q = opts.q?.trim().slice(0, 60);
  const where: Prisma.MemberWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: normalizePhone(q) } }, { code: { contains: q, mode: "insensitive" } }] } : {};
  const page = Math.max(1, opts.page ?? 1);
  let rows;
  let total: number;
  if (opts.sort?.key === "name") {
    // ชื่อไทย: เรียงตามพจนานุกรมในแอป (DB เรียงตามรหัสอักขระ)
    const all = await db.member.findMany({ where, select: { id: true, name: true, code: true } });
    total = all.length;
    const ids = thaiSortedPageIds(all, (m) => m.name, (m) => m.code, opts.sort.dir, page, MEMBER_PAGE_SIZE);
    const found = await db.member.findMany({ where: { id: { in: ids } }, select: memberSelect });
    const byId = new Map(found.map((m) => [m.id, m]));
    rows = ids.map((id) => byId.get(id)).filter((m): m is (typeof found)[number] => !!m);
  } else {
    [rows, total] = await Promise.all([
      db.member.findMany({ where, select: memberSelect, orderBy: opts.sort ? memberOrder(opts.sort) : [{ isActive: "desc" }, { code: "asc" }], skip: (page - 1) * MEMBER_PAGE_SIZE, take: MEMBER_PAGE_SIZE }),
      db.member.count({ where }),
    ]);
  }
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE)),
    items: rows.map((m) => ({ ...m, totalSpent: m.totalSpent.toFixed(2), createdAt: m.createdAt.toISOString() })),
  };
}

/** ค้นหาสำหรับหน้า POS (CASHIER ใช้ได้) — คืนเฉพาะข้อมูลที่จำเป็น และเฉพาะสมาชิกที่ใช้งานอยู่ */
export async function searchMembersForPos(q: string) {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const rows = await db.member.findMany({
    where: { isActive: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: normalizePhone(term) } }, { code: { contains: term, mode: "insensitive" } }] },
    select: { id: true, code: true, name: true, phone: true, points: true },
    orderBy: { code: "asc" },
    take: 8,
  });
  return rows.map((m) => ({ id: m.id, code: m.code, name: m.name, phoneTail: m.phone.slice(-4), points: m.points }));
}

async function nextCode(tx: Tx) {
  // ล็อกระดับ transaction (ปล่อยเองเมื่อ commit/rollback) เพื่อให้การออกรหัสสมาชิกเรียงทีละคน ไม่ชนกันเมื่อสร้างพร้อมกัน
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(72001)`;
  const rows = await tx.$queryRaw<{ n: number | null }[]>`SELECT MAX(CAST(SUBSTRING(code FROM 2) AS INTEGER)) AS n FROM "Member" WHERE code ~ '^M[0-9]+$'`;
  return `M${String((rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

export async function createMember(actor: CurrentUser, input: { name: string; phone: string; email: string | null }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const m = await tx.member.create({ data: { code: await nextCode(tx), name: input.name, phone: input.phone, email: input.email }, select: memberSelect });
        await audit(tx, { userId: actor.id, action: "MEMBER_CREATE", entity: "Member", entityId: m.id, after: { code: m.code, name: m.name } });
        return { id: m.id, code: m.code };
      });
    } catch (e) {
      const f = uniqueViolationFields(e);
      if (!f) throw e;
      if (f.includes("phone")) throw new BusinessError("เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว");
      // ชน code (สร้างพร้อมกัน) → ลองใหม่
    }
  }
  throw new BusinessError("สร้างรหัสสมาชิกไม่สำเร็จ กรุณาลองใหม่");
}

export async function updateMember(actor: CurrentUser, input: { id: string; name: string; phone: string; email: string | null }) {
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.member.findUnique({ where: { id: input.id }, select: { name: true, phone: true, email: true } });
      if (!before) throw new BusinessError("ไม่พบสมาชิก");
      await tx.member.update({ where: { id: input.id }, data: { name: input.name, phone: input.phone, email: input.email } });
      await audit(tx, { userId: actor.id, action: "MEMBER_UPDATE", entity: "Member", entityId: input.id, before, after: { name: input.name, phone: input.phone, email: input.email } });
    });
  } catch (e) {
    if (uniqueViolationFields(e)?.includes("phone")) throw new BusinessError("เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว");
    throw e;
  }
}

export async function setMemberActive(actor: CurrentUser, input: { id: string; isActive: boolean }) {
  await db.$transaction(async (tx) => {
    const before = await tx.member.findUnique({ where: { id: input.id }, select: { isActive: true } });
    if (!before) throw new BusinessError("ไม่พบสมาชิก");
    if (before.isActive === input.isActive) return;
    await tx.member.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    await audit(tx, { userId: actor.id, action: input.isActive ? "MEMBER_ENABLE" : "MEMBER_DISABLE", entity: "Member", entityId: input.id });
  });
}

export async function getMemberDetail(id: string) {
  const m = await db.member.findUnique({ where: { id }, select: memberSelect });
  if (!m) return null;
  const [ledger, sales] = await Promise.all([
    db.pointTransaction.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { sale: { select: { receiptNo: true } } } }),
    db.sale.findMany({ where: { memberId: id, receiptNo: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, receiptNo: true, total: true, createdAt: true, pointsEarned: true } }),
  ]);
  return {
    member: { ...m, totalSpent: m.totalSpent.toFixed(2), createdAt: m.createdAt.toISOString() },
    ledger: ledger.map((l) => ({ id: l.id, createdAt: l.createdAt.toISOString(), type: l.type, points: l.points, balanceAfter: l.balanceAfter, note: l.note, receiptNo: l.sale?.receiptNo ?? null, saleId: l.saleId })),
    sales: sales.map((s) => ({ id: s.id, receiptNo: s.receiptNo!, total: s.total.toFixed(2), createdAt: s.createdAt.toISOString(), pointsEarned: s.pointsEarned })),
  };
}

/** ตรวจสมาชิกก่อนผูกกับบิล: ต้องมีอยู่และใช้งานอยู่ */
export async function assertMemberUsable(tx: Tx, memberId: string) {
  const m = await tx.member.findUnique({ where: { id: memberId }, select: { id: true, isActive: true } });
  if (!m) throw new BusinessError("ไม่พบสมาชิก");
  if (!m.isActive) throw new BusinessError("สมาชิกนี้ถูกปิดใช้งาน");
}
