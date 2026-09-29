import { prisma } from '../../lib/prisma';
import { cacheGet, cacheSet } from '../../lib/cache';
import { env } from '../../config/env';
import { getSettings } from '../settings/settings.service';

type Unavailable = { status: 'unavailable'; reason: string; dataSource: null };

function unavailable(reason: string): Unavailable {
  return { status: 'unavailable', reason, dataSource: null };
}

// ---------------------------------------------------------------------------
// 1. GET /api/dashboard/summary
// ---------------------------------------------------------------------------

export async function getDashboardSummary(organizationId: string, userId: string) {
  const cacheKey = `dashboard:summary:${organizationId}:${userId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  // Production prospectivity values are sourced only from canonical ML predictions.
  // Legacy deterministic ProspectivityPrediction rows are intentionally not used here.
  let selectedLocation: unknown = unavailable('No production ML prediction is available for this organization.');
  let predictedMnConcentration: unknown = unavailable('Mn concentration prediction unavailable — insufficient verified assay data.');
  let confidence: unknown = unavailable('No production ML prediction available.');
  let uncertainty: unknown = unavailable('No production ML prediction available.');
  let prospectivity: unknown = unavailable('No production ML prediction available.');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.lastSelectedZoneId) {
    const zone = await prisma.zone.findFirst({ where: { id: user.lastSelectedZoneId, mine: { organizationId } }, select: { id: true, name: true, region: true, latitude: true, longitude: true } });
    if (zone) selectedLocation = { zoneId: zone.id, name: zone.name, region: zone.region, latitude: zone.latitude, longitude: zone.longitude };
  }

  const settings = await getSettings(organizationId, userId);
  const [activeMiningAreas, highProspectivityZones, recentAnalyses, systemStatus, analyzedCount, areaAggregate] = await Promise.all([
    prisma.zone.count({ where: { mine: { organizationId }, status: 'ACTIVE_EXTRACTION' } }),
    prisma.prospectivityZone.count({ where: { organizationId, prospectivityScore: { gte: settings.prospectivityThreshold }, modelVersion: { mlStatus: 'PRODUCTION', status: 'DEPLOYED' } } }),
    listRecentAnalyses(organizationId, 5),
    getSystemStatusSummary(),
    prisma.prediction.count({ where: { organizationId, modelVersion: { mlStatus: 'PRODUCTION', status: 'DEPLOYED' } } }),
    prisma.zone.aggregate({ where: { mine: { organizationId } }, _sum: { areaKm2: true } }),
  ]);

  const result = {
    selectedLocation,
    predictedMnConcentration,
    confidence,
    uncertainty,
    prospectivity,
    activeMiningAreas,
    highProspectivityZones,
    areasAnalyzed: analyzedCount,
    totalAreaProcessedKm2: areaAggregate._sum.areaKm2 ?? null,
    highestPredictedMn: unavailable('Mn concentration prediction unavailable — insufficient verified assay data.'),
    averagePredictedMn: unavailable('Mn concentration prediction unavailable — insufficient verified assay data.'),
    recentAnalyses,
    systemStatus,
    settings: { riskThreshold: settings.riskThreshold, prospectivityThreshold: settings.prospectivityThreshold, forecastHorizon: settings.forecastHorizon },
    lastUpdated: new Date().toISOString(),
  };

  await cacheSet(cacheKey, result, env.cacheTtl.dashboardSummary);
  return result;
}

// ---------------------------------------------------------------------------
// 2. GET /api/dashboard/top-zones
// ---------------------------------------------------------------------------

const SORT_FIELDS = {
  prospectivity: 'prospectivityScore',
  confidence: 'confidence',
  predictedMn: 'predictedMnConcentration',
} as const;

export async function getTopZones(params: {
  organizationId: string;
  limit?: number;
  mineId?: string;
  region?: string;
  minimumProspectivity?: number;
  sort?: keyof typeof SORT_FIELDS;
}) {
  const { organizationId, limit = 10, mineId, region, minimumProspectivity, sort = 'prospectivity' } = params;
  const defaultSettings = await prisma.organizationSettings.findUnique({ where: { organizationId } });
  const effectiveMinimum = minimumProspectivity ?? defaultSettings?.prospectivityThreshold ?? 75;
  const cacheKey = `dashboard:top-zones:${JSON.stringify(params)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  if (sort === 'predictedMn') return { status: 'unavailable', reason: 'Mn concentration ranking unavailable — insufficient verified assay data.', results: [] };

  const zones = await prisma.prospectivityZone.findMany({
    where: {
      organizationId, status: 'ACTIVE', prospectivityScore: { gte: effectiveMinimum },
      modelVersion: { mlStatus: 'PRODUCTION', status: 'DEPLOYED' },
      region: region ?? undefined,
      sourceAnalysisJob: mineId ? { mineId } : undefined,
    },
    orderBy: sort === 'confidence' ? { confidence: 'desc' } : { prospectivityScore: 'desc' },
    take: limit,
  });

  const result = zones.map((z) => ({
    id: z.id, name: `AI zone ${z.id.slice(0, 8)}`, region: z.region ?? 'Unspecified',
    latitude: z.centerLatitude, longitude: z.centerLongitude, area: null,
    prospectivity: z.prospectivityScore, confidence: z.confidence, predictedMn: null,
    modelVersion: null, generatedAt: z.generatedAt,
  }));

  await cacheSet(cacheKey, result, env.cacheTtl.topZones);
  return result;
}

// ---------------------------------------------------------------------------
// 3. GET /api/dashboard/manganese-distribution
// ---------------------------------------------------------------------------

export async function getManganeseDistribution(params: {
  organizationId: string;
  mineId?: string;
  region?: string;
  startDate?: string;
  endDate?: string;
  resolution?: 'day' | 'week' | 'month';
}) {
  const { organizationId, mineId, region, startDate, endDate } = params;
  const cacheKey = `dashboard:mn-distribution:${JSON.stringify(params)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const where = {
    zone: { mine: { organizationId, id: mineId ?? undefined }, region: region ?? undefined },
    measuredAt: {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(endDate) : undefined,
    },
  };

  const rows = await prisma.manganeseObservation.findMany({ where, orderBy: { measuredAt: 'asc' } });

  if (rows.length === 0) {
    return unavailable('No manganese concentration observations recorded for the requested range.');
  }

  // Bucket by (kind, binLabel) — never merge observed/modelled/predicted counts.
  const buckets: Record<'observed' | 'modelled' | 'predicted', Record<string, number>> = {
    observed: {},
    modelled: {},
    predicted: {},
  };
  const kindMap = { OBSERVED: 'observed', MODELLED: 'modelled', PREDICTED: 'predicted' } as const;
  for (const row of rows) {
    const kind = kindMap[row.kind];
    buckets[kind][row.binLabel] = (buckets[kind][row.binLabel] ?? 0) + 1;
  }

  const result = {
    observed: Object.entries(buckets.observed).map(([label, value]) => ({ label, value })),
    modelled: Object.entries(buckets.modelled).map(([label, value]) => ({ label, value })),
    predicted: Object.entries(buckets.predicted).map(([label, value]) => ({ label, value })),
  };

  await cacheSet(cacheKey, result, env.cacheTtl.mnDistribution);
  return result;
}

// ---------------------------------------------------------------------------
// 4. GET /api/dashboard/recent-analyses
// ---------------------------------------------------------------------------

export async function listRecentAnalyses(organizationId: string, limit = 10) {
  const jobs = await prisma.analysisJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { zone: true, modelVersion: true, resultPrediction: true },
  });

  return jobs.map((job) => ({
    analysisId: job.id,
    location: job.zone ? { name: job.zone.name, region: job.zone.region } : unavailable('Job was not scoped to a stored zone.'),
    analysisType: job.analysisType,
    status: job.status,
    modelVersion: job.modelVersion ? `${job.modelVersion.name} v${job.modelVersion.version}` : null,
    prospectivity: job.resultPrediction
      ? { level: job.resultPrediction.prospectivityLevel, score: job.resultPrediction.prospectivityScore }
      : null,
    confidence: job.resultPrediction?.confidence ?? null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  }));
}

// ---------------------------------------------------------------------------
// System status (used by both /dashboard/summary and /system/status)
// ---------------------------------------------------------------------------

export async function getSystemStatusSummary() {
  const rows = await prisma.systemComponentStatus.findMany();
  if (rows.length === 0) return unavailable('System health checks have not reported in yet.');
  return rows.reduce((acc, row) => {
    acc[row.component] = { status: row.status, latencyMs: row.latencyMs, lastCheckedAt: row.lastCheckedAt };
    return acc;
  }, {} as Record<string, { status: string; latencyMs: number | null; lastCheckedAt: Date }>);
}
