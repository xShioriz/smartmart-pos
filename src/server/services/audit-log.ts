import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { bangkokDayRange } from "@/lib/date";

export const AUDIT_PAGE_SIZE = 30;

export type AuditFilter = { action?: string; userId?: string; from?: string; to?: string; page?: number };

export async function listAuditLogs(f: AuditFilter) {
  const where: Prisma.AuditLogWhereInput = {
    ...(f.action && { action: f.action }),
    ...(f.userId && { userId: f.userId }),
    ...((f.from || f.to) && {
      createdAt: {
        ...(f.from && { gte: bangkokDayRange(f.from).start }),
        ...(f.to && { lt: bangkokDayRange(f.to).end }),
      },
    }),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, actions, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, include: { user: { select: { name: true } } } }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actions: actions.map((a) => a.action),
    users,
    rows: rows.map((r) => ({
      id: r.id, createdAt: r.createdAt.toISOString(), action: r.action, entity: r.entity, entityId: r.entityId, user: r.user?.name ?? null,
      before: r.before ? JSON.stringify(r.before, null, 2) : null, after: r.after ? JSON.stringify(r.after, null, 2) : null,
    })),
  };
}
