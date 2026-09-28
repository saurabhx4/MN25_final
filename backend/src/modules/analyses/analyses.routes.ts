import { Router } from 'express';
import { Queue } from 'bullmq';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { newAnalysisBody, comparisonBody, regionAnalysisBody } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';
import { cacheInvalidate } from '../../lib/cache';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { isValidPolygon, polygonAreaKm2, type GeoJsonPolygon } from '../../lib/geo/geometry';
import { linkAnalysisDatasets } from '../datasets/dataset.service';
import { ensureCanonicalAnalysis } from '../domain/domain.service';

export const analysesRouter = Router();
analysesRouter.use(requireAuth);

const connection = { url: env.redisUrl };
const analysisQueue = new Queue('analysis-jobs', { connection });

// POST /api/analyses  — Dashboard "New Analysis" quick action
analysesRouter.post('/', requirePermission('analysis.run'), async (req, res, next) => {
  try {
    const body = newAnalysisBody.parse(req.body);
    if (!body.zoneId && (body.latitude === undefined || body.longitude === undefined)) {
      throw new AppError(400, 'invalid_request', 'Provide either zoneId or latitude/longitude.');
    }

    const job = await prisma.analysisJob.create({
      data: {
        organizationId: req.user!.organizationId,
        mineId: body.mineId,
        zoneId: body.zoneId,
        requestedByUserId: req.user!.id,
        analysisType: body.analysisType,
        status: 'QUEUED',
        inputPayload: body,
      },
    });

    await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
    await ensureCanonicalAnalysis(job.id, req.user!.organizationId);
    await analysisQueue.add('run-analysis', { jobId: job.id });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'dashboard.new_analysis.requested',
      resourceType: 'AnalysisJob',
      resourceId: job.id,
      metadata: body,
    });
    await cacheInvalidate(`dashboard:summary:${req.user!.organizationId}`);
    await cacheInvalidate('dashboard:top-zones');

    res.status(202).json({ analysisId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/analyses/comparison — Dashboard "Compare Regions" quick action
analysesRouter.post('/comparison', async (req, res, next) => {
  try {
    const body = comparisonBody.parse(req.body);
    const zones = await prisma.zone.findMany({
      where: { id: { in: body.zoneIds }, mine: { organizationId: req.user!.organizationId } },
    });
    if (zones.length !== body.zoneIds.length) {
      throw new AppError(404, 'not_found', 'One or more zones were not found for this organization.');
    }

    const job = await prisma.analysisJob.create({
      data: {
        organizationId: req.user!.organizationId,
        requestedByUserId: req.user!.id,
        analysisType: 'REGION_COMPARISON',
        status: 'QUEUED',
        inputPayload: body,
      },
    });

    await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
    await ensureCanonicalAnalysis(job.id, req.user!.organizationId);
    await analysisQueue.add('run-comparison', { jobId: job.id, zoneIds: body.zoneIds });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'dashboard.compare_regions.requested',
      resourceType: 'AnalysisJob',
      resourceId: job.id,
      metadata: body,
    });

    res.status(202).json({ analysisId: job.id, status: job.status });
  } catch (err) {
    next(err);
  }
});

const MAX_REGION_AREA_KM2 = Number(process.env.MAX_REGION_ANALYSIS_AREA_KM2 ?? 50000);

// POST /api/analyses/region — Explore §I ("AI scan of selected geographic area")
// Validates the drawn geometry and queues an async job; the expensive
// geospatial/AI work never runs synchronously in the request.
analysesRouter.post('/region', async (req, res, next) => {
  try {
    const body = regionAnalysisBody.parse(req.body);

    if (!isValidPolygon(body.geometry)) {
      throw new AppError(400, 'invalid_geometry', 'geometry must be a closed GeoJSON Polygon with valid lat/lng coordinates.');
    }
    const geometry = body.geometry as GeoJsonPolygon;
    const areaKm2 = polygonAreaKm2(geometry);
    if (areaKm2 <= 0) {
      throw new AppError(400, 'invalid_geometry', 'geometry encloses zero area.');
    }
    if (areaKm2 > MAX_REGION_AREA_KM2) {
      throw new AppError(400, 'area_too_large', `Selected region is ${Math.round(areaKm2)} km², which exceeds the ${MAX_REGION_AREA_KM2} km² analysis limit.`);
    }

    const job = await prisma.analysisJob.create({
      data: {
        organizationId: req.user!.organizationId,
        requestedByUserId: req.user!.id,
        analysisType: body.analysisType,
        status: 'QUEUED',
        regionGeometry: geometry,
        regionAreaKm2: areaKm2,
        requestedLayers: body.requestedLayers ?? undefined,
        inputPayload: body,
      },
    });

    await linkAnalysisDatasets(job.id, req.user!.organizationId, body.datasetIds);
    await ensureCanonicalAnalysis(job.id, req.user!.organizationId);
    await analysisQueue.add('run-region-analysis', { jobId: job.id, requestedModelVersion: body.modelVersion });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'explore.region_analysis.requested',
      resourceType: 'AnalysisJob',
      resourceId: job.id,
      metadata: { areaKm2, analysisType: body.analysisType },
    });

    res.status(202).json({ analysisId: job.id, geometry, status: job.status });
  } catch (err) {
    next(err);
  }
});

// GET /api/analyses/:analysisId/status — Explore §J (poll queued/processing/completed/failed)
analysesRouter.get('/:id/status', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true, status: true, errorMessage: true, createdAt: true, completedAt: true },
    });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    res.json({
      analysisId: job.id,
      status: mapStatus(job.status),
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analyses/:analysisId/result — Explore §J
analysesRouter.get('/:id/result', async (req, res, next) => {
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
      return res.status(409).json({ error: 'not_ready', message: `Analysis is ${mapStatus(job.status).toLowerCase()}, not completed.`, status: mapStatus(job.status) });
    }

    if (job.resultZone) {
      return res.json({
        prospectivity: { score: job.resultZone.prospectivityScore },
        confidence: job.resultZone.confidence,
        uncertainty: job.resultZone.uncertainty ?? null,
        provenance: { inputDatasetVersion: job.resultZone.inputDatasetVersion },
        modelVersion: `${job.resultZone.modelVersion.name} v${job.resultZone.modelVersion.version}`,
        spectralIndicators: (job.resultPayload as Record<string, unknown> | null)?.spectralIndicators ?? null,
        geologyIndicators: (job.resultPayload as Record<string, unknown> | null)?.geologyIndicators ?? null,
        terrainIndicators: (job.resultPayload as Record<string, unknown> | null)?.terrainIndicators ?? null,
      });
    }

    if (job.resultPayload) {
      return res.json(job.resultPayload);
    }

    return res.status(500).json({ error: 'internal_error', message: 'Job is marked completed but has no result recorded.' });
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

// GET /api/analyses/:id/provenance — immutable dataset inputs used by the analysis.
analysesRouter.get('/:id/provenance', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, include: { datasetLinks: { include: { dataset: true, datasetVersion: true } } } });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    const canonical = await ensureCanonicalAnalysis(job.id, req.user!.organizationId);
    res.json({ analysisId: job.id, canonicalAnalysisId: canonical.id, datasets: job.datasetLinks.map(link => ({ role: link.role, dataset: { id: link.dataset.id, name: link.dataset.name, type: link.dataset.type, provider: link.dataset.provider }, versionId: link.datasetVersion?.id ?? null, version: link.datasetVersion?.version ?? link.dataset.version, checksum: link.datasetVersion?.checksum ?? link.dataset.checksum, sourceUrl: link.datasetVersion?.sourceUrl ?? link.dataset.sourceUrl })) });
  } catch (err) { next(err); }
});

// GET /api/analyses/:id — poll job status (used by the frontend after a quick action)
analysesRouter.get('/:id', async (req, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { resultPrediction: true },
    });
    if (!job) throw new AppError(404, 'not_found', 'Analysis job not found.');
    res.json({
      analysisId: job.id,
      status: job.status,
      errorMessage: job.errorMessage,
      result: job.resultPrediction
        ? {
            predictedMnConcentration: job.resultPrediction.predictedMnConcentration,
            confidence: job.resultPrediction.confidence,
            uncertainty: job.resultPrediction.uncertainty,
            prospectivityLevel: job.resultPrediction.prospectivityLevel,
          }
        : null,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    next(err);
  }
});
