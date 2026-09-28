import { prisma } from '../../lib/prisma';
import { ensureCanonicalModel } from '../domain/domain.service';
import type { ModelType, Prisma } from '@prisma/client';

const PURPOSE: Record<ModelType, string> = {
  PROSPECTIVITY: 'Manganese prospectivity',
  MN_CONCENTRATION: 'Mn concentration estimation',
  PRODUCTION_FORECAST: 'Production forecasting',
  RISK: 'Operational risk',
};

export async function registerModelVersion(params: {
  organizationId?: string | null;
  name: string;
  version: string;
  type: ModelType;
  description?: string | null;
  trainingDataset?: string | null;
  trainingDate?: Date | null;
  metrics?: unknown;
  features?: unknown;
}) {
  const orgId = params.organizationId ?? null;
  const existingModel = await prisma.modelRegistry.findFirst({ where: { organizationId: orgId, name: params.name } });
  const model = existingModel
    ? await prisma.modelRegistry.update({
        where: { id: existingModel.id },
        data: {
          purpose: PURPOSE[params.type],
          type: params.type,
          ...(params.trainingDataset !== undefined ? { trainingDataset: params.trainingDataset } : {}),
          ...(params.trainingDate !== undefined ? { trainingDate: params.trainingDate } : {}),
          ...(params.metrics !== undefined && params.metrics !== null ? { metrics: params.metrics as Prisma.InputJsonValue } : {}),
          ...(params.features !== undefined && params.features !== null ? { features: params.features as Prisma.InputJsonValue } : {}),
        },
      })
    : await prisma.modelRegistry.create({
        data: {
          organizationId: orgId,
          name: params.name,
          purpose: PURPOSE[params.type],
          type: params.type,
          status: 'DRAFT',
          trainingDataset: params.trainingDataset ?? undefined,
          trainingDate: params.trainingDate ?? undefined,
          metrics: params.metrics as Prisma.InputJsonValue | undefined,
          features: params.features as Prisma.InputJsonValue | undefined,
        },
      });

  const version = await prisma.modelVersion.upsert({
    where: { name_version: { name: params.name, version: params.version } },
    update: {
      modelId: model.id,
      type: params.type,
      description: params.description ?? undefined,
      trainingDataset: params.trainingDataset ?? undefined,
      trainingDate: params.trainingDate ?? undefined,
      metrics: params.metrics as Prisma.InputJsonValue | undefined,
      features: params.features as Prisma.InputJsonValue | undefined,
    },
    create: {
      modelId: model.id,
      name: params.name,
      version: params.version,
      type: params.type,
      description: params.description ?? undefined,
      trainingDataset: params.trainingDataset ?? undefined,
      trainingDate: params.trainingDate ?? undefined,
      metrics: params.metrics as Prisma.InputJsonValue | undefined,
      features: params.features as Prisma.InputJsonValue | undefined,
      status: 'DRAFT',
    },
  });

  await ensureCanonicalModel(version.id, params.organizationId ?? (model.organizationId ?? 'global'));
  return { model, version };
}

export async function assertDeployedModel(modelVersionId: string, organizationId: string) {
  const version = await prisma.modelVersion.findFirst({
    where: {
      id: modelVersionId,
      status: 'DEPLOYED',
      model: { OR: [{ organizationId: null }, { organizationId }] },
    },
    include: { model: true },
  });
  if (!version || !version.model) throw new Error('MODEL_NOT_DEPLOYED');
  return version;
}

export function hasValidationMetrics(metrics: unknown): boolean {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return false;
  return Object.values(metrics as Record<string, unknown>).some((v) => typeof v === 'number' && Number.isFinite(v));
}
