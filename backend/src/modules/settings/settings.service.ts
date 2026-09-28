import { prisma } from '../../lib/prisma';
import { cacheInvalidate } from '../../lib/cache';
import { recordAudit } from '../audit/audit.service';
import { AppError } from '../../middleware/errorHandler';

const DEFAULT_FORECAST_HORIZON = 30;
const DEFAULT_RISK_THRESHOLD = 70;
const DEFAULT_PROSPECTIVITY_THRESHOLD = 75;

export async function getSettings(organizationId: string, userId: string) {
  const [org, user] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
    prisma.userSettings.findUnique({ where: { userId }, include: { selectedMine: true } }),
  ]);

  const mine = user?.selectedMine && user.selectedMine.organizationId === organizationId ? user.selectedMine : null;
  const role = (await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { role: true } }))?.role;
  const canWriteOperational = role === 'ADMIN' || role === 'MANAGER';
  const canWriteFull = role === 'ADMIN';

  return {
    selectedMine: mine ? { id: mine.id, name: mine.name, region: mine.region } : null,
    forecastHorizon: org?.forecastHorizon ?? DEFAULT_FORECAST_HORIZON,
    riskThreshold: org?.riskThreshold ?? DEFAULT_RISK_THRESHOLD,
    prospectivityThreshold: org?.prospectivityThreshold ?? DEFAULT_PROSPECTIVITY_THRESHOLD,
    defaultModel: org?.defaultModel ?? null,
    timezone: user?.timezone ?? 'UTC',
    units: user?.units ?? 'metric',
    notificationPreferences: user?.notificationPreferences ?? {},
    permissions: { canWriteOperational, canWriteFull },
  };
}

export async function ensureSettings(organizationId: string, userId: string) {
  await prisma.organizationSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });
  await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function updateSettings(params: {
  organizationId: string;
  userId: string;
  role: string;
  changes: {
    selectedMineId?: string | null;
    forecastHorizon?: number;
    riskThreshold?: number;
    prospectivityThreshold?: number;
    defaultModel?: string | null;
    timezone?: string;
    units?: string;
    notificationPreferences?: unknown;
  };
  reason?: string;
}) {
  await ensureSettings(params.organizationId, params.userId);
  const canWriteOperational = params.role === 'ADMIN' || params.role === 'MANAGER';
  const canWriteFull = params.role === 'ADMIN';

  const orgFields = ['forecastHorizon', 'riskThreshold', 'prospectivityThreshold'];
  const fullOrgFields = ['defaultModel'];
  const userFields = ['selectedMineId', 'timezone', 'units', 'notificationPreferences'];
  const attemptedOrg = Object.keys(params.changes).some(k => orgFields.includes(k));
  const attemptedFull = Object.keys(params.changes).some(k => fullOrgFields.includes(k));
  const attemptedUser = Object.keys(params.changes).some(k => userFields.includes(k));
  if ((attemptedUser && !canWriteOperational) || (attemptedOrg && !canWriteOperational) || (attemptedFull && !canWriteFull)) {
    throw new AppError(403, 'forbidden', 'Insufficient role for requested settings.');
  }

  if (params.changes.selectedMineId) {
    const mine = await prisma.mine.findFirst({ where: { id: params.changes.selectedMineId, organizationId: params.organizationId }, select: { id: true } });
    if (!mine) {
      throw new AppError(400, 'invalid_mine', 'Selected mine is not part of the current organization.');
    }
  }

  const before = await getSettings(params.organizationId, params.userId);
  await prisma.$transaction(async tx => {
    const c = params.changes;
    const orgData: any = {};
    if (c.forecastHorizon !== undefined) orgData.forecastHorizon = c.forecastHorizon;
    if (c.riskThreshold !== undefined) orgData.riskThreshold = c.riskThreshold;
    if (c.prospectivityThreshold !== undefined) orgData.prospectivityThreshold = c.prospectivityThreshold;
    if (c.defaultModel !== undefined) orgData.defaultModel = c.defaultModel;
    if (Object.keys(orgData).length) await tx.organizationSettings.update({ where: { organizationId: params.organizationId }, data: orgData });

    const userData: any = {};
    if (c.selectedMineId !== undefined) userData.selectedMineId = c.selectedMineId;
    if (c.timezone !== undefined) userData.timezone = c.timezone;
    if (c.units !== undefined) userData.units = c.units;
    if (c.notificationPreferences !== undefined) userData.notificationPreferences = c.notificationPreferences as any;
    if (Object.keys(userData).length) await tx.userSettings.update({ where: { userId: params.userId }, data: userData });
  });

  await cacheInvalidate(`dashboard:summary:${params.organizationId}:`);
  await cacheInvalidate('dashboard:top-zones:');
  const after = await getSettings(params.organizationId, params.userId);
  await recordAudit({
    organizationId: params.organizationId, userId: params.userId, action: 'settings.updated', resourceType: 'Settings',
    metadata: { oldValue: before, newValue: after, reason: params.reason ?? null },
  });
  return after;
}
