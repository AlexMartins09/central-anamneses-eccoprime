import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { clientIp } from "./rate-limit";

type AuditInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
};

/** Registra ação administrativa. Nunca deve derrubar a operação principal. */
export async function audit(input: AuditInput, tx: Tx = prisma) {
  try {
    let ip: string | null = null;
    try {
      ip = await clientIp();
    } catch {
      /* fora de contexto de request (cron/seed) */
    }
    await tx.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        details: input.details,
        ip,
      },
    });
  } catch (e) {
    console.error("[audit] falha ao registrar", e);
  }
}
