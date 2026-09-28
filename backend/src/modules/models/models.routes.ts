import { Router } from 'express';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../audit/audit.service';
import { ensureCanonicalModel } from '../domain/domain.service';

export const modelsRouter = Router();
modelsRouter.use(requireAuth);

function hasValidationMetrics(metrics: unknown): boolean {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return false;
  return Object.values(metrics as Record<string, unknown>).some((v) => typeof v === 'number' && Number.isFinite(v));
}

function serializeVersion(v: {
  id: string; name: string; version: string; type: string; description: string | null; status: string;
  trainingDataset: string | null; trainingDate: Date | null; metrics: unknown; features: unknown;
  deploymentDate: Date | null; releasedAt: Date;
}) {
  return {
    id: v.id,
    name: v.name,
    version: v.version,
    type: v.type,
    description: v.description,
    status: v.status,
    trainingDataset: v.trainingDataset,
    trainingDate: v.trainingDate,
    metrics: v.metrics ?? null,
    features: v.features ?? null,
    deploymentDate: v.deploymentDate,
    releasedAt: v.releasedAt,
    productionReady: v.status === 'DEPLOYED' && hasValidationMetrics(v.metrics),
  };
}

// GET /api/models — tenant models only; global registry entries may be visible
// to all authenticated tenants, but organization-owned records never cross tenants.
modelsRouter.get('/', requirePermission('data.read'), async (req, res, next) => {
  try {
    const models = await prisma.modelRegistry.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] },
      include: { versions: { orderBy: { releasedAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });
    if (models.length === 0) {
      return res.json({ status: 'unavailable', reason: 'No model is registered.', results: [] });
    }
    res.json({ results: models.map((m) => ({
      modelId: m.id,
      modelVersion: m.currentVersion ? `${m.name} v${m.currentVersion}` : (m.versions[0] ? `${m.name} v${m.versions[0].version}` : '—'),
      name: m.name,
      purpose: m.purpose,
      type: m.type,
      status: m.status,
      version: m.currentVersion ?? m.versions[0]?.version ?? null,
      trainingDataset: m.trainingDataset,
      modelTrainingDataset: m.trainingDataset,
      trainingDate: m.trainingDate,
      modelCreatedAt: m.trainingDate ?? m.createdAt,
      metrics: m.metrics ?? null,
      features: m.features ?? null,
      modelMetrics: m.metrics ?? null,
      deploymentDate: m.deploymentDate,
      latestVersion: m.versions[0] ? serializeVersion(m.versions[0]) : null,
    })) });
  } catch (err) { next(err); }
});

// GET /api/models/:id/metrics
modelsRouter.get('/:id/metrics', requirePermission('data.read'), async (req, res, next) => {
  try {
    const model = await prisma.modelRegistry.findFirst({
      where: { id: req.params.id, OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] },
      include: { versions: { orderBy: { releasedAt: 'desc' } } },
    });
    if (!model) throw new AppError(404, 'not_found', 'Model not found.');
    res.json({ modelId: model.id, name: model.name, status: model.status, metrics: model.metrics ?? null, versions: model.versions.map((v) => ({ versionId: v.id, version: v.version, status: v.status, metrics: v.metrics ?? null, validated: hasValidationMetrics(v.metrics) })) });
  } catch (err) { next(err); }
});

// GET /api/models/:id/versions
modelsRouter.get('/:id/versions', requirePermission('data.read'), async (req, res, next) => {
  try {
    const model = await prisma.modelRegistry.findFirst({
      where: { id: req.params.id, OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] },
      include: { versions: { orderBy: { releasedAt: 'desc' } } },
    });
    if (!model) throw new AppError(404, 'not_found', 'Model not found.');
    res.json({ modelId: model.id, name: model.name, versions: model.versions.map(serializeVersion) });
  } catch (err) { next(err); }
});

// GET /api/models/predictions/:predictionId — complete reproducibility record.
modelsRouter.get('/predictions/:predictionId', requirePermission('data.read'), async (req, res, next) => {
  try {
    const prediction = await prisma.modelPrediction.findFirst({
      where: { id: req.params.predictionId, organizationId: req.user!.organizationId },
      include: { model: true, modelVersion: true },
    });
    if (!prediction) throw new AppError(404, 'not_found', 'Prediction record not found.');
    const geometry = await prisma.$queryRawUnsafe<Array<{ geojson: string | null }>>('SELECT ST_AsGeoJSON("geometry") AS geojson FROM "ModelPrediction" WHERE "id" = $1', prediction.id);
    res.json({
      predictionId: prediction.id,
      modelId: prediction.modelId,
      modelName: prediction.model.name,
      modelVersion: prediction.modelVersion.version,
      modelVersionId: prediction.modelVersionId,
      inputDatasetVersions: prediction.inputDatasetVersions,
      geometry: geometry[0]?.geojson ? JSON.parse(geometry[0].geojson) : null,
      prediction: prediction.prediction,
      confidence: prediction.confidence,
      uncertainty: prediction.uncertainty,
      explanation: prediction.explanation ?? null,
      generatedAt: prediction.generatedAt,
    });
  } catch (err) { next(err); }
});


// GET /api/models/:id
modelsRouter.get('/:id', requirePermission('data.read'), async (req, res, next) => {
  try {
    const model = await prisma.modelRegistry.findFirst({
      where: { id: req.params.id, OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] },
      include: { versions: { orderBy: { releasedAt: 'desc' } } },
    });
    if (!model) throw new AppError(404, 'not_found', 'Model not found.');
    const latest = model.versions[0] ?? null;
    const canonicalModelId = latest ? (await ensureCanonicalModel(latest.id, req.user!.organizationId)).id : null;
    res.json({
      id: model.id,
      modelId: model.id,
      name: model.name,
      purpose: model.purpose,
      modelVersion: model.currentVersion ? `${model.name} v${model.currentVersion}` : (latest ? `${model.name} v${latest.version}` : '—'),
      version: model.currentVersion ?? latest?.version ?? null,
      status: model.status,
      type: model.type,
      trainingDataset: model.trainingDataset,
      modelTrainingDataset: model.trainingDataset,
      trainingDate: model.trainingDate,
      modelCreatedAt: model.trainingDate ?? model.createdAt,
      metrics: model.metrics ?? null,
      modelMetrics: model.metrics ?? null,
      features: model.features ?? null,
      deploymentDate: model.deploymentDate,
      versions: model.versions.map(serializeVersion),
      canonicalModelId,
    });
  } catch (err) { next(err); }
});

// Admin-controlled deployment. A model/version cannot become production-ready
// until validation metrics exist.
modelsRouter.post('/:id/versions/:versionId/deploy', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const model = await prisma.modelRegistry.findFirst({ where: { id: req.params.id, OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] } });
    if (!model) throw new AppError(404, 'not_found', 'Model not found.');
    if (model.organizationId !== req.user!.organizationId) throw new AppError(403, 'forbidden', 'Global model deployment is managed outside the organization.');
    const version = await prisma.modelVersion.findFirst({ where: { id: req.params.versionId, modelId: model.id } });
    if (!version) throw new AppError(404, 'not_found', 'Model version not found.');
    if (!hasValidationMetrics(version.metrics)) throw new AppError(422, 'validation_required', 'Model version cannot be deployed until validation metrics exist.');

    await prisma.$transaction([
      prisma.modelVersion.updateMany({ where: { modelId: model.id, status: 'DEPLOYED' }, data: { status: 'RETIRED' } }),
      prisma.modelVersion.update({ where: { id: version.id }, data: { status: 'DEPLOYED', deploymentDate: new Date() } }),
      prisma.modelRegistry.update({ where: { id: model.id }, data: { status: 'DEPLOYED', currentVersion: version.version, metrics: version.metrics ?? undefined, trainingDataset: version.trainingDataset, trainingDate: version.trainingDate, features: version.features, deploymentDate: new Date() } }),
    ]);
    await ensureCanonicalModel(version.id, req.user!.organizationId);
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'model.deployed', resourceType: 'ModelVersion', resourceId: version.id, metadata: { modelId: model.id, model: model.name, version: version.version } });
    res.json({ modelId: model.id, modelVersionId: version.id, status: 'DEPLOYED', version: version.version });
  } catch (err) { next(err); }
});

// Internal service contract: only a DEPLOYED model/version may generate a
// production prediction. Workers call this before writing prediction output.
export async function requireDeployedModel(modelVersionId: string, organizationId: string) {
  const version = await prisma.modelVersion.findFirst({
    where: { id: modelVersionId, status: 'DEPLOYED', mlStatus: 'PRODUCTION', model: { OR: [{ organizationId: null }, { organizationId }] } },
    include: { model: true },
  });
  if (!version || !version.model) throw new AppError(409, 'model_not_deployed', 'The requested model version is not deployed and cannot generate production predictions.');
  return version;
}

