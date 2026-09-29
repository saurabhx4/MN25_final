import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export async function recordAudit(params: {
  organizationId: string | null;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  // Audit writes must never block or fail the primary request — log and swallow.
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        metadata: (params.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('audit_log_write_failed', err);
  }
}
