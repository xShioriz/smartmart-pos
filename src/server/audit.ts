import type { Prisma, PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

export type AuditInput = {
  userId?: string | null;
  action: string; // เช่น USER_CREATE, USER_ROLE_CHANGE, LOGIN_FAILED
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

/** เรียกใน transaction เดียวกับการกระทำ เพื่อให้บันทึกและข้อมูลสอดคล้องกัน */
export async function audit(client: Client, input: AuditInput) {
  await client.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: input.before,
      after: input.after,
    },
  });
}
