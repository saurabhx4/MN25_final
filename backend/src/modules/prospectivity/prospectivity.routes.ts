import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { hotspotsQuery } from '../../utils/validation';
import { parseBboxParam } from '../../lib/geo/geometry';

export const prospectivityRouter = Router();
prospectivityRouter.use(requireAuth);

// GET /api/prospectivity/hotspots — Explore §E
// A hotspot is always a ProspectivityZone row (a model prediction), never a
// Zone (documented location) — the two models cannot be conflated because
// they are structurally different tables/response shapes.
prospectivityRouter.get('/hotspots', async (req, res, next) => {
  try {
    const query = hotspotsQuery.parse(req.query);
    const bbox = query.bbox ? parseBboxParam(query.bbox) : null;
    if (query.bbox && !bbox) throw new AppError(400, 'invalid_bbox', 'bbox must be "west,south,east,north" with valid ranges.');

    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }],
    };
    if (query.region) where.region = { contains: query.region, mode: 'insensitive' };
    const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: req.user!.organizationId } });
    where.prospectivityScore = { gte: query.minimumScore ?? settings?.prospectivityThreshold ?? 75 };
    where.modelVersion = { mlStatus: 'PRODUCTION', status: 'DEPLOYED', ...(query.modelVersion ? { version: query.modelVersion } : {}) };
    if (bbox) {
      where.centerLatitude = { gte: bbox.south, lte: bbox.north };
      where.centerLongitude = { gte: bbox.west, lte: bbox.east };
    }

    const orderBy =
      query.sortBy === 'confidence'
        ? { confidence: 'desc' as const }
        : query.sortBy === 'generatedAt'
        ? { generatedAt: 'desc' as const }
        : { prospectivityScore: 'desc' as const };

    const zones = await prisma.prospectivityZone.findMany({
      where,
      include: { modelVersion: true },
      orderBy,
      take: query.limit,
    });

    res.json({
      results: zones.map((z) => ({
        zoneId: z.id,
        // geometry is fetched separately below to avoid Unsupported-type
        // serialization issues with the Prisma client on the main query
        center: { latitude: z.centerLatitude, longitude: z.centerLongitude },
        prospectivityScore: z.prospectivityScore,
        confidence: z.confidence,
        modelVersion: `${z.modelVersion.name} v${z.modelVersion.version}`,
        generatedAt: z.generatedAt,
        status: z.status,
        note: 'AI model prediction — not a confirmed manganese deposit.',
      })),
      count: zones.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/prospectivity/zones/:id — Explore §F
prospectivityRouter.get('/zones/:id', async (req, res, next) => {
  try {
    const zone = await prisma.prospectivityZone.findFirst({
      where: {
        id: req.params.id,
        OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }],
        modelVersion: { mlStatus: 'PRODUCTION', status: 'DEPLOYED' },
      },
      include: { modelVersion: true },
    });
    if (!zone) throw new AppError(404, 'not_found', 'Prospectivity zone not found.');

    const geometryRows = await prisma.$queryRawUnsafe<Array<{ geojson: string }>>(
      `SELECT ST_AsGeoJSON(geometry) AS geojson FROM "ProspectivityZone" WHERE id = $1`,
      zone.id
    );

    res.json({
      prediction: { prospectivityScore: zone.prospectivityScore, note: 'Model prediction — not a confirmed manganese deposit.' },
      confidence: zone.confidence,
      geometry: geometryRows[0] ? JSON.parse(geometryRows[0].geojson) : null,
      modelVersion: `${zone.modelVersion.name} v${zone.modelVersion.version}`,
      featureContributions: zone.featureContributions ?? null, // never invented — null when the model provided none
      inputDatasets: zone.inputDatasetVersion,
      timestamp: zone.generatedAt,
      uncertainty: zone.uncertainty ?? null,
      limitations: zone.limitations ?? 'No additional model limitations were provided.',
    });
  } catch (err) {
    next(err);
  }
});
