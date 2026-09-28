import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';

export async function getActionPlan(organizationId: string, id: string) {
  return prisma.actionPlan.findFirst({
    where: { id, organizationId },
    include: {
      recommendations: { orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] },
      factors: { orderBy: { name: 'asc' } },
      actions: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function listRecommendations(params: {
  organizationId: string; mineId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  dateFrom?: Date; dateTo?: Date;
}) {
  return prisma.recommendation.findMany({
    where: {
      organizationId: params.organizationId,
      mineId: params.mineId,
      priority: params.priority,
      createdAt: { gte: params.dateFrom, lte: params.dateTo },
      actions: params.status ? { some: { status: params.status } } : undefined,
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
}

export async function listActions(params: {
  organizationId: string; mineId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; limit?: number;
}) {
  return prisma.action.findMany({
    where: { organizationId: params.organizationId, mineId: params.mineId, priority: params.priority, status: params.status },
    orderBy: { createdAt: 'desc' }, take: params.limit ?? 100, include: { recommendation: true },
  });
}

async function getOwnedAction(organizationId: string, actionId: string) {
  return prisma.action.findFirst({ where: { id: actionId, organizationId } });
}

export async function approveAction(params: { organizationId: string; userId: string; actionId: string; notes?: string }) {
  const action = await getOwnedAction(params.organizationId, params.actionId);
  if (!action) return null;
  if (action.status !== 'PENDING') throw new Error(`Action is ${action.status.toLowerCase()} and cannot be approved.`);
  const updated = await prisma.action.update({ where: { id: action.id }, data: { status: 'APPROVED', approvedBy: params.userId, approvedAt: new Date(), notes: params.notes ?? action.notes } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'projects.action.approved', resourceType: 'Action', resourceId: action.id, metadata: { notes: params.notes ?? null } });
  return updated;
}

export async function rejectAction(params: { organizationId: string; userId: string; actionId: string; reason?: string }) {
  const action = await getOwnedAction(params.organizationId, params.actionId);
  if (!action) return null;
  if (action.status !== 'PENDING') throw new Error(`Action is ${action.status.toLowerCase()} and cannot be rejected.`);
  const updated = await prisma.action.update({ where: { id: action.id }, data: { status: 'REJECTED', rejectedBy: params.userId, rejectedAt: new Date(), notes: params.reason ?? action.notes } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'projects.action.rejected', resourceType: 'Action', resourceId: action.id, metadata: { reason: params.reason ?? null } });
  return updated;
}

export async function scheduleAction(params: { organizationId: string; userId: string; actionId: string; scheduledFor: Date; assignedTeam?: string; notes?: string }) {
  const action = await getOwnedAction(params.organizationId, params.actionId);
  if (!action) return null;
  if (!['PENDING', 'APPROVED'].includes(action.status)) throw new Error(`Action is ${action.status.toLowerCase()} and cannot be scheduled.`);
  const updated = await prisma.action.update({ where: { id: action.id }, data: { status: 'SCHEDULED', scheduledFor: params.scheduledFor, assignedTeam: params.assignedTeam ?? action.assignedTeam, notes: params.notes ?? action.notes } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'projects.action.scheduled', resourceType: 'Action', resourceId: action.id, metadata: { scheduledFor: params.scheduledFor.toISOString(), assignedTeam: params.assignedTeam ?? null } });
  return updated;
}

export async function completeAction(params: { organizationId: string; userId: string; actionId: string; executionResult?: unknown }) {
  const action = await getOwnedAction(params.organizationId, params.actionId);
  if (!action) return null;
  if (!['APPROVED', 'SCHEDULED'].includes(action.status)) throw new Error(`Action is ${action.status.toLowerCase()} and cannot be completed.`);
  const updated = await prisma.action.update({ where: { id: action.id }, data: { status: 'COMPLETED', completedAt: new Date(), executionResult: params.executionResult === undefined ? undefined : (params.executionResult as any) } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'projects.action.completed', resourceType: 'Action', resourceId: action.id, metadata: { executionResult: params.executionResult ?? null } });
  return updated;
}

export async function getDecisionFactors(organizationId: string, actionPlanId: string) {
  const plan = await prisma.actionPlan.findFirst({ where: { id: actionPlanId, organizationId }, select: { id: true } });
  if (!plan) return null;
  return prisma.decisionFactor.findMany({ where: { actionPlanId: plan.id }, orderBy: { name: 'asc' } });
}
