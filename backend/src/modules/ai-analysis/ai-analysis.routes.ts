import { Router } from 'express';
import { Queue } from 'bullmq';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { aiAnalysisCreateBody, regionAnalysisBody } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { isValidPolygon, polygonAreaKm2, type GeoJsonPolygon } from '../../lib/geo/geometry';
import { linkAnalysisDatasets } from '../datasets/dataset.service';

// This module implements the literal /api/ai-analysis contract used by the
// AI Analysis page (Overview / Region Analysis / Model Insights tabs). It
// shares the same `analysis-jobs` BullMQ queue and worker
// (src/workers/analysisWorker.ts) as the pre-existing /api/analyses module —
// both are just different HTTP surfaces over the same AnalysisJob pipeline,
// so there is exactly one place that actually runs inference.

export const aiAnalysisRouter = Router();
aiAnalysisRouter.use(requireAuth);

const mlQueue = new Queue('ml-jobs', { connection: { url: env.redisUrl } });
const MAX_REGION_AREA_KM2 = Number(process.env.MAX_REGION_ANALYSIS_AREA_KM2 ?? 50000);

async function getProductionProspectivityModel(organizationId: string, requested?: string | null) {
  if (requested) {
    const idx = requested.lastIndexOf(' v');
    const name = idx > 0 ? requested.slice(0, idx) : requested;
    const version = idx > 0 ? requested.slice(idx + 2) : undefined;
    return prisma.modelVersion.findFirst({ where: { type: 'PROSPECTIVITY', ...(version ? { name, version } : { name }), mlStatus: 'PRODUCTION', status: 'DEPLOYED', model: { OR: [{ organizationId: null }, { organizationId }] } }, orderBy: { releasedAt: 'desc' } });
  }
  return prisma.modelVersion.findFirst({ where: { type: 'PROSPECTIVITY', mlStatus: 'PRODUCTION', status: 'DEPLOYED', model: { OR: [{ organizationId: null }, { organizationId }] } }, orderBy: { releasedAt: 'desc' } });
}


// POST /api/ai-analysis — generic job creation for either a documented zone
// (subjectType: "zone") or a drawn region (subjectType: "region").
aiAnalysisRouter.post('/', requirePermission('analysis.run'), async (req, res, next) => {
  try {
    const body = aiAnalysisCreateBody.parse(req.body);

    if (body.subjectType === 'region') {
      if (!isValidPolygon(body.geometry)) {
        throw new AppError(400, 'invalid_geometry', 'geometry must be a closed GeoJSON Polygon with valid lat/lng coordinates.');
      }
      const geometry = body.geometry as GeoJsonPolygon;
      const areaKm2 = polygonAreaKm2(geometry);
      if (areaKm2 <= 0) throw new AppError(400, 'invalid_geometry', 'geometry encloses zero area.');
      if (areaKm2 > MAX_REGION_AREA_KM2) {
        throw new AppError(400, 'area_too_large', `Selected region is ${Math.round(areaKm2)} km², which exceeds the ${MAX_REGION_AREA_KM2} km² analysis limit.`);
      }
      const productionModel = await getProductionProspectivityModel(req.user!.organizationId, body.modelVersion);
      if (!productionModel || !productionModel.datasetVersion || !productionModel.featureVersion) throw new AppError(409, 'model_not_available', 'MODEL NOT TRAINED — no production prospectivity model with registered dataset and feature versions is available.');

      const job = await prisma.analysisJob.create({
        data: {
          organizationId: req.user!.organizationId,
          requestedByUserId: req.user!.id,
          analysisType: 'REGION_SCAN',
          status: 'QUEUED',
          currentStage: 'data_validation',
          progress: 0,
          regionGeometry: geometry,
          regionAreaKm2: areaKm2,
          requestedLayers: body.requestedAnalyses,
          inputPayload: body,
        },
      });
      await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
      const mlRun = await prisma.mLPredictionRun.create({ data: { organizationId: req.user!.organizationId, requestedByUserId: req.user!.id, modelVersionId: productionModel.id, datasetVersion: productionModel.datasetVersion, featureVersion: productionModel.featureVersion, geometry, status: 'QUEUED', analysisJobId: job.id } });
      await mlQueue.add('predict-prospectivity', { predictionRunId: mlRun.id });
      await recordAudit({
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        action: 'ai_analysis.region.requested',
        resourceType: 'AnalysisJob',
        resourceId: job.id,
        metadata: { areaKm2, requestedAnalyses: body.requestedAnalyses },
      });
      return res.status(202).json({ analysisId: job.id, status: 'queued' });
    }

    // subjectType === 'zone'
    const zone = await prisma.zone.findFirst({
      where: { id: body.subjectId, mine: { organizationId: req.user!.organizationId } },
    });
    if (!zone) throw new AppError(404, 'not_found', 'Zone (subjectId) not found for this organization.');
    const productionModel = await getProductionProspectivityModel(req.user!.organizationId, body.modelVersion);
    if (!productionModel || !productionModel.datasetVersion || !productionModel.featureVersion) throw new AppError(409, 'model_not_available', 'MODEL NOT TRAINED — no production prospectivity model with registered dataset and feature versions is available.');

    const job = await prisma.analysisJob.create({
      data: {
        organizationId: req.user!.organizationId,
        zoneId: zone.id,
        mineId: zone.mineId,
        requestedByUserId: req.user!.id,
        analysisType: 'PROSPECTIVITY',
        status: 'QUEUED',
        currentStage: 'data_validation',
        progress: 0,
        inputPayload: body,
      },
    });
    await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
    const mlRun = await prisma.mLPredictionRun.create({ data: { organizationId: req.user!.organizationId, requestedByUserId: req.user!.id, modelVersionId: productionModel.id, datasetVersion: productionModel.datasetVersion, featureVersion: productionModel.featureVersion, geometry: { type: 'Point', coordinates: [zone.longitude, zone.latitude] }, status: 'QUEUED', analysisJobId: job.id } });
    await mlQueue.add('predict-prospectivity', { predictionRunId: mlRun.id });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'ai_analysis.zone.requested',
      resourceType: 'AnalysisJob',
      resourceId: job.id,
      metadata: { zoneId: zone.id, requestedAnalyses: body.requestedAnalyses },
    });
    res.status(202).json({ analysisId: job.id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai-analysis/region — Region Analysis tab, drawn-polygon scan.
aiAnalysisRouter.post('/region', async (req, res, next) => {
  try {
    const body = regionAnalysisBody.parse(req.body);
    if (!isValidPolygon(body.geometry)) {
      throw new AppError(400, 'invalid_geometry', 'geometry must be a closed GeoJSON Polygon with valid lat/lng coordinates.');
    }
    const geometry = body.geometry as GeoJsonPolygon;
    const areaKm2 = polygonAreaKm2(geometry);
    if (areaKm2 <= 0) throw new AppError(400, 'invalid_geometry', 'geometry encloses zero area.');
    if (areaKm2 > MAX_REGION_AREA_KM2) {
      throw new AppError(400, 'area_too_large', `Selected region is ${Math.round(areaKm2)} km², which exceeds the ${MAX_REGION_AREA_KM2} km² analysis limit.`);
    }
    const productionModel = await getProductionProspectivityModel(req.user!.organizationId, body.modelVersion);
    if (!productionModel || !productionModel.datasetVersion || !productionModel.featureVersion) throw new AppError(409, 'model_not_available', 'MODEL NOT TRAINED — no production prospectivity model with registered dataset and feature versions is available.');

    const job = await prisma.analysisJob.create({
      data: {
        organizationId: req.user!.organizationId,
        requestedByUserId: req.user!.id,
        analysisType: body.analysisType,
        status: 'QUEUED',
        currentStage: 'data_validation',
        progress: 0,
        regionGeometry: geometry,
        regionAreaKm2: areaKm2,
        requestedLayers: body.requestedLayers ?? undefined,
        inputPayload: body,
      },
    });
    await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
    const mlRun = await prisma.mLPredictionRun.create({ data: { organizationId: req.user!.organizationId, requestedByUserId: req.user!.id, modelVersionId: productionModel.id, datasetVersion: productionModel.datasetVersion, featureVersion: productionModel.featureVersion, geometry, status: 'QUEUED', analysisJobId: job.id } });
    await mlQueue.add('predict-prospectivity', { predictionRunId: mlRun.id });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'ai_analysis.region.requested',
      resourceType: 'AnalysisJob',
      resourceId: job.id,
      metadata: { areaKm2 },
    });
    res.status(202).json({ analysisId: job.id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai-analysis/:id/status — staged progress polling.
aiAnalysisRouter.get('/:id/status', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { status: true, progress: true, currentStage: true, startedAt: true, completedAt: true, errorMessage: true },
    });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    res.json({
      status: mapStatus(job.status),
      progress: job.progress,
      currentStage: job.currentStage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.errorMessage ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai-analysis/:id/overview
aiAnalysisRouter.get('/:id/overview', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        resultPrediction: { include: { modelVersion: true } },
        resultZone: { include: { modelVersion: true } },
      },
    });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    if (job.status !== 'COMPLETED') {
      return res.status(409).json({ status: 'unavailable', reason: `Analysis is ${mapStatus(job.status)}, not completed.` });
    }

    const resultPayload = job.resultPayload as Record<string, unknown> | null;

    if (job.resultZone) {
      return res.json({
        prospectivityScore: job.resultZone.prospectivityScore,
        confidence: job.resultZone.confidence,
        uncertainty: job.resultZone.uncertainty ?? null,
        predictedMnConcentration: (resultPayload?.predictedMnConcentration as number | undefined) ?? null,
        analysisArea: job.regionAreaKm2 ?? null,
        modelVersion: `${job.resultZone.modelVersion.name} v${job.resultZone.modelVersion.version}`,
        generatedAt: job.resultZone.generatedAt,
        note: 'Prospectivity score is a model prediction, not proof of mineralization.',
      });
    }

    if (job.resultPrediction) {
      return res.json({
        prospectivityScore: job.resultPrediction.prospectivityScore,
        confidence: job.resultPrediction.confidence,
        uncertainty: job.resultPrediction.uncertainty,
        predictedMnConcentration: job.resultPrediction.predictedMnConcentration,
        analysisArea: job.regionAreaKm2 ?? null,
        modelVersion: `${job.resultPrediction.modelVersion.name} v${job.resultPrediction.modelVersion.version}`,
        generatedAt: job.resultPrediction.createdAt,
        note: 'Prospectivity score is a model prediction, not proof of mineralization.',
      });
    }

    return res.status(500).json({ error: 'internal_error', message: 'Job is marked completed but has no result recorded.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai-analysis/:id/explainability — real explainability output only.
aiAnalysisRouter.get('/:id/explainability', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { resultZone: true },
    });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    if (job.status !== 'COMPLETED') {
      return res.status(409).json({ status: 'unavailable', reason: `Analysis is ${mapStatus(job.status)}, not completed.` });
    }

    const contributions = job.resultZone?.featureContributions as Record<string, number> | null | undefined;
    if (!contributions || Object.keys(contributions).length === 0) {
      return res.json({
        status: 'unavailable',
        reason: 'The model run for this analysis did not produce a feature-attribution output.',
        features: [],
      });
    }

    res.json({
      status: 'available',
      format: 'feature_importance',
      features: Object.entries(contributions).map(([feature, contribution]) => ({ feature, contribution })),
      limitations: job.resultZone?.limitations ?? null,
    });
  } catch (err) {
    next(err);
  }
});

function mapStatus(status: string): 'queued' | 'processing' | 'completed' | 'failed' {
  if (status === 'QUEUED') return 'queued';
  if (status === 'RUNNING') return 'processing';
  if (status === 'COMPLETED') return 'completed';
  return 'failed';
}
