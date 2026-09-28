import { Router } from 'express';
import { Queue } from 'bullmq';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { spectralAnalysisBody } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { getSatelliteProvider } from '../../lib/satellite/satellite.provider';

export const spectralAnalysisRouter = Router();
spectralAnalysisRouter.use(requireAuth);

const spectralQueue = new Queue('spectral-jobs', { connection: { url: env.redisUrl } });

// POST /api/spectral-analysis — Spectral Analysis tab.
// Only queues real work: checks that a satellite catalog is even configured
// before accepting the job, so the UI gets an honest "unavailable" reason
// immediately rather than a job that will fail 30 seconds later.
spectralAnalysisRouter.post('/', requirePermission('analysis.run'), async (req, res, next) => {
  try {
    const body = spectralAnalysisBody.parse(req.body);
    const satelliteProvider = getSatelliteProvider();

    const analysis = await prisma.spectralAnalysis.create({
      data: {
        organizationId: req.user!.organizationId,
        requestedByUserId: req.user!.id,
        sceneId: body.sceneId,
        geometry: body.geometry,
        bandConfiguration: body.bandConfiguration,
        status: satelliteProvider.configured ? 'QUEUED' : 'UNAVAILABLE',
        unavailableReason: satelliteProvider.configured
          ? null
          : 'No satellite catalog is configured (SATELLITE_STAC_URL unset) — a scene must exist before spectral features can be computed.',
      },
    });

    if (satelliteProvider.configured) {
      await spectralQueue.add('run-spectral-analysis', { spectralAnalysisId: analysis.id });
    }

    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'ai_analysis.spectral.requested',
      resourceType: 'SpectralAnalysis',
      resourceId: analysis.id,
      metadata: { sceneId: body.sceneId ?? null },
    });

    res.status(202).json({ analysisId: analysis.id, status: analysis.status.toLowerCase() });
  } catch (err) {
    next(err);
  }
});

// GET /api/spectral-analysis/:id
spectralAnalysisRouter.get('/:id', async (req, res, next) => {
  try {
    const analysis = await prisma.spectralAnalysis.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { modelVersion: true, dataSource: true },
    });
    if (!analysis) throw new AppError(404, 'not_found', 'Spectral analysis not found.');

    if (analysis.status === 'UNAVAILABLE') {
      return res.json({ status: 'unavailable', reason: analysis.unavailableReason });
    }
    if (analysis.status === 'FAILED') {
      return res.json({ status: 'failed', error: analysis.errorMessage });
    }
    if (analysis.status !== 'COMPLETED') {
      return res.json({ status: analysis.status.toLowerCase() });
    }

    res.json({
      status: 'completed',
      sceneId: analysis.sceneId,
      bandStatistics: analysis.bandStatistics,
      indices: analysis.indices,
      anomalyMap: analysis.anomalyMap,
      spectralSignatures: analysis.spectralSignatures,
      pixelDistributions: analysis.pixelDistributions,
      qualityMetrics: analysis.qualityMetrics,
      modelVersion: analysis.modelVersion ? `${analysis.modelVersion.name} v${analysis.modelVersion.version}` : null,
      dataSource: analysis.dataSource ? { name: analysis.dataSource.name, datasetVersion: analysis.dataSource.datasetVersion, provenanceUrl: analysis.dataSource.provenanceUrl } : null,
      completedAt: analysis.completedAt,
    });
  } catch (err) {
    next(err);
  }
});
