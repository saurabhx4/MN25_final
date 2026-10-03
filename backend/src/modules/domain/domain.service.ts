import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

/**
 * Canonical domain graph adapter.
 *
 * The existing MN25 services pre-date the unified graph and still persist
 * some specialized records (AnalysisJob, ModelRegistry, ModelPrediction,
 * Zone). This service creates/maintains canonical entities alongside those
 * records without changing their public API contracts. New consumers should
 * use the canonical graph and provenance endpoints below.
 */

export async function ensureCanonicalModel(modelVersionId: string, organizationId: string) {
  const version = await prisma.modelVersion.findFirst({
    where: { id: modelVersionId },
    include: { model: true },
  });
  if (!version) throw new AppError(404, 'not_found', 'Model version not found.');
  if (version.model && version.model.organizationId && version.model.organizationId !== organizationId) {
    throw new AppError(403, 'forbidden', 'Model does not belong to the authenticated organization.');
  }

  const canonicalOrgId = version.model?.organizationId ?? null;
  const existingCanonical = await prisma.model.findFirst({ where: { organizationId: canonicalOrgId, name: version.name } });
  const canonical = existingCanonical
    ? await prisma.model.update({ where: { id: existingCanonical.id }, data: { purpose: version.model?.purpose ?? modelPurpose(version.type), type: version.type, status: version.status, currentVersion: version.version } })
    : await prisma.model.create({ data: { organizationId: canonicalOrgId, name: version.name, purpose: version.model?.purpose ?? modelPurpose(version.type), type: version.type, status: version.status, currentVersion: version.version } });

  await prisma.modelVersion.update({
    where: { id: version.id },
    data: { canonicalModelId: canonical.id },
  });
  return canonical;
}

export async function ensureCanonicalAnalysis(analysisJobId: string, organizationId: string) {
  const job = await prisma.analysisJob.findFirst({
    where: { id: analysisJobId, organizationId },
    include: { datasetLinks: { include: { datasetVersion: true } } },
  });
  if (!job) throw new AppError(404, 'not_found', 'Analysis not found.');

  let regionId: string | null = null;
  if (job.regionGeometry) {
    regionId = job.id;
    await prisma.region.upsert({
      where: { id: regionId },
      update: { mineId: job.mineId, metadata: { analysisId: job.id, areaKm2: job.regionAreaKm2 } },
      create: { id: regionId, organizationId: job.organizationId, mineId: job.mineId, name: `Analysis region ${job.id}`, metadata: { analysisId: job.id, areaKm2: job.regionAreaKm2 } },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "Region" SET geometry = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)) WHERE id = $2`,
      JSON.stringify(job.regionGeometry), regionId,
    );
  }

  const canonical = await prisma.analysis.upsert({
    where: { legacyAnalysisId: job.id },
    update: {
      status: job.status,
      modelVersionId: job.modelVersionId,
      mineId: job.mineId,
      regionId,
      requestedByUserId: job.requestedByUserId,
      analysisType: job.analysisType,
      geometry: job.regionGeometry ?? null,
      inputSnapshot: buildAnalysisSnapshot(job),
      completedAt: job.completedAt,
    },
    create: {
      organizationId: job.organizationId,
      legacyAnalysisId: job.id,
      mineId: job.mineId,
      regionId,
      requestedByUserId: job.requestedByUserId,
      analysisType: job.analysisType,
      status: job.status,
      modelVersionId: job.modelVersionId,
      geometry: job.regionGeometry ?? null,
      inputSnapshot: buildAnalysisSnapshot(job),
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
  });

  if (job.canonicalAnalysisId !== canonical.id) {
    await prisma.analysisJob.update({ where: { id: job.id }, data: { canonicalAnalysisId: canonical.id } });
  }
  return canonical;
}

export async function ensureCanonicalPrediction(modelPredictionId: string, organizationId: string, analysisId?: string) {
  const legacy = await prisma.modelPrediction.findFirst({
    where: { id: modelPredictionId, organizationId },
    include: { modelVersion: true, model: true },
  });
  if (!legacy) throw new AppError(404, 'not_found', 'Prediction not found.');

  const canonicalModel = await ensureCanonicalModel(legacy.modelVersionId, organizationId);
  const canonicalAnalysis = analysisId ? await ensureCanonicalAnalysis(analysisId, organizationId) : null;

  const existing = await prisma.prediction.findFirst({ where: { id: legacy.id } });
  const canonical = existing
    ? await prisma.prediction.update({
        where: { id: existing.id },
        data: {
          modelId: canonicalModel.id,
          modelVersionId: legacy.modelVersionId,
          analysisId: canonicalAnalysis?.id ?? existing.analysisId,
          prediction: legacy.prediction,
          confidence: legacy.confidence,
          uncertainty: legacy.uncertainty,
          inputDatasetVersions: legacy.inputDatasetVersions,
          explainability: legacy.explanation,
          generatedAt: legacy.generatedAt,
        },
      })
    : await prisma.prediction.create({
        data: {
          id: legacy.id,
          organizationId,
          modelId: canonicalModel.id,
          modelVersionId: legacy.modelVersionId,
          analysisId: canonicalAnalysis?.id,
          prediction: legacy.prediction,
          confidence: legacy.confidence,
          uncertainty: legacy.uncertainty,
          inputDatasetVersions: legacy.inputDatasetVersions,
          explainability: legacy.explanation,
          generatedAt: legacy.generatedAt,
        },
      });

  const inputs = Array.isArray(legacy.inputDatasetVersions) ? legacy.inputDatasetVersions : [];
  for (const input of inputs) {
    if (!input || typeof input !== 'object') continue;
    const item = input as Record<string, unknown>;
    const datasetVersionId = typeof item.datasetVersionId === 'string' ? item.datasetVersionId : null;
    if (!datasetVersionId) continue;
    const datasetVersion = await prisma.datasetVersion.findFirst({ where: { id: datasetVersionId, organizationId } });
    if (!datasetVersion) continue;
    await prisma.predictionDatasetVersion.upsert({
      where: { predictionId_datasetVersionId_role: { predictionId: canonical.id, datasetVersionId, role: String(item.role ?? 'input') } },
      create: { predictionId: canonical.id, datasetVersionId, role: String(item.role ?? 'input') },
      update: {},
    });
  }

  return canonical;
}

export async function getPredictionProvenance(predictionId: string, organizationId: string) {
  const prediction = await prisma.prediction.findFirst({
    where: { id: predictionId, organizationId },
    include: {
      model: true,
      modelVersion: true,
      analysis: true,
      datasetVersions: { include: { datasetVersion: { include: { dataset: true } } } },
    },
  });
  if (!prediction) throw new AppError(404, 'not_found', 'Prediction not found.');
  const geometry = await prisma.$queryRaw<Array<{ geojson: string | null }>>`
    SELECT ST_AsGeoJSON("geometry") AS geojson FROM "Prediction" WHERE "id" = ${prediction.id}
  `;
  return {
    predictionId: prediction.id,
    model: { id: prediction.model.id, name: prediction.model.name, purpose: prediction.model.purpose },
    modelVersion: {
      id: prediction.modelVersion.id,
      version: prediction.modelVersion.version,
      status: prediction.modelVersion.status,
      trainingDataset: prediction.modelVersion.trainingDataset,
      trainingDate: prediction.modelVersion.trainingDate,
      metrics: prediction.modelVersion.metrics,
      features: prediction.modelVersion.features,
      deploymentDate: prediction.modelVersion.deploymentDate,
    },
    inputDatasetVersions: prediction.datasetVersions.map((x) => ({
      datasetId: x.datasetVersion.dataset.id,
      datasetName: x.datasetVersion.dataset.name,
      type: x.datasetVersion.dataset.type,
      versionId: x.datasetVersion.id,
      version: x.datasetVersion.version,
      checksum: x.datasetVersion.checksum,
      provider: x.datasetVersion.provider,
      sourceUrl: x.datasetVersion.sourceUrl,
      role: x.role,
    })),
    analysisId: prediction.analysis?.id ?? null,
    geometry: geometry[0]?.geojson ? JSON.parse(geometry[0].geojson) : null,
    prediction: prediction.prediction,
    confidence: prediction.confidence,
    uncertainty: prediction.uncertainty,
    explainability: prediction.explainability,
    generatedAt: prediction.generatedAt,
  };
}

export async function getAnalysisProvenance(analysisId: string, organizationId: string) {
  const analysis = await prisma.analysis.findFirst({
    where: { id: analysisId, organizationId },
    include: {
      modelVersion: true,
      results: { include: { prediction: true } },
    },
  });
  if (!analysis) throw new AppError(404, 'not_found', 'Analysis not found.');
  const links = analysis.legacyAnalysisId
    ? await prisma.analysisDatasetLink.findMany({
        where: { analysisJobId: analysis.legacyAnalysisId, organizationId },
        include: { dataset: true, datasetVersion: true },
      })
    : [];
  return {
    analysisId: analysis.id,
    legacyAnalysisId: analysis.legacyAnalysisId,
    status: analysis.status,
    analysisType: analysis.analysisType,
    geometry: analysis.geometry,
    modelVersion: analysis.modelVersion ? { id: analysis.modelVersion.id, name: analysis.modelVersion.name, version: analysis.modelVersion.version, status: analysis.modelVersion.status } : null,
    datasets: links.map((l) => ({ datasetId: l.dataset.id, datasetName: l.dataset.name, type: l.dataset.type, role: l.role, versionId: l.datasetVersion?.id ?? null, version: l.datasetVersion?.version ?? null, checksum: l.datasetVersion?.checksum ?? null })),
    results: analysis.results.map((r) => ({ id: r.id, type: r.resultType, predictionId: r.predictionId, payload: r.payload, explainability: r.explainability, createdAt: r.createdAt })),
    inputSnapshot: analysis.inputSnapshot,
  };
}

function modelPurpose(type: string) {
  if (type === 'PROSPECTIVITY') return 'Manganese prospectivity';
  if (type === 'MN_CONCENTRATION') return 'Mn concentration estimation';
  if (type === 'PRODUCTION_FORECAST') return 'Production forecasting';
  return 'Operational risk';
}

function buildAnalysisSnapshot(job: { inputPayload: unknown; requestedLayers: unknown; regionAreaKm2: number | null; currentStage: string | null }): Prisma.InputJsonObject {
  return { inputPayload: job.inputPayload, requestedLayers: job.requestedLayers, regionAreaKm2: job.regionAreaKm2, currentStage: job.currentStage } as Prisma.InputJsonObject;
}

export async function syncCanonicalMiningAreas(organizationId: string) {
  const zones = await prisma.zone.findMany({ where: { mine: { organizationId } }, select: { id: true, mineId: true, name: true, region: true, latitude: true, longitude: true, areaKm2: true, status: true, recordType: true, commodity: true, state: true, district: true, mineType: true, sourceName: true, sourceUrl: true, updatedAt: true } });
  for (const zone of zones) {
    await prisma.miningArea.upsert({
      where: { legacyZoneId: zone.id },
      update: { name: zone.name, metadata: zone },
      create: { organizationId, mineId: zone.mineId, legacyZoneId: zone.id, name: zone.name, metadata: zone },
    });
  }
  return zones.length;
}
