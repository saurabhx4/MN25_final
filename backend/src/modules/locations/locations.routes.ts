import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

export const locationsRouter = Router();
locationsRouter.use(requireAuth);

function unavailable(reason: string) {
  return { status: 'unavailable', reason, dataSource: null };
}

// GET /api/locations/:locationId/summary
locationsRouter.get('/:locationId/summary', async (req, res, next) => {
  try {
    const zone = await prisma.zone.findFirst({
      where: { id: req.params.locationId, mine: { organizationId: req.user!.organizationId } },
      include: {
        mine: true,
        predictions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { modelVersion: true, dataSources: { include: { dataSource: true } } },
        },
      },
    });
    if (!zone) throw new AppError(404, 'not_found', 'Location not found for this organization.');

    // Remember this as the user's selected location, so /dashboard/summary reflects it.
    await prisma.user.update({ where: { id: req.user!.id }, data: { lastSelectedZoneId: zone.id } });

    const prediction = zone.predictions[0];

    res.json({
      coordinates: { latitude: zone.latitude, longitude: zone.longitude },
      administrativeRegion: zone.region,
      geology: zone.geology ?? unavailable('No geology attributes recorded for this zone.'),
      knownMiningStatus: zone.status,
      predictedMn: prediction ? { value: prediction.predictedMnConcentration, unit: 'percent' } : unavailable('No prediction on record.'),
      prospectivity: prediction
        ? { level: prediction.prospectivityLevel, score: prediction.prospectivityScore }
        : unavailable('No prediction on record.'),
      confidence: prediction ? { value: prediction.confidence, unit: 'percent' } : unavailable('No prediction on record.'),
      uncertainty: prediction ? { value: prediction.uncertainty, unit: 'percent' } : unavailable('No prediction on record.'),
      dataSources: prediction
        ? prediction.dataSources.map((l) => ({ name: l.dataSource.name, type: l.dataSource.type, datasetVersion: l.dataSource.datasetVersion }))
        : [],
      lastAnalysis: prediction
        ? { predictionId: prediction.id, modelVersion: `${prediction.modelVersion.name} v${prediction.modelVersion.version}`, createdAt: prediction.createdAt }
        : unavailable('This zone has not been analyzed yet.'),
    });
  } catch (err) {
    next(err);
  }
});
