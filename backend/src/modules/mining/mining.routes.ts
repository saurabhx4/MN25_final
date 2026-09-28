import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { nearbyMiningQuery, miningAreasQuery } from '../../utils/validation';
import { parseBboxParam } from '../../lib/geo/geometry';
import { syncCanonicalMiningAreas } from '../domain/domain.service';

export const miningRouter = Router();
miningRouter.use(requireAuth);

function unavailable(reason: string) {
  return { status: 'unavailable' as const, reason, dataSource: null };
}

// Never expose operator/production to RESEARCHER role — Explore §L (security).
function redactOperationalFields<T extends { operatorName?: string | null; productionTonnesPerYear?: number | null }>(
  row: T,
  role: string
) {
  if (role === 'RESEARCHER') {
    return { ...row, operatorName: null, productionTonnesPerYear: null };
  }
  return row;
}

// GET /api/mining/nearby — Explore §B
// Uses PostGIS ST_DWithin/ST_Distance against the geography cast of `location`
// (indexed point column) rather than any client-side haversine math.
miningRouter.get('/nearby', async (req, res, next) => {
  try {
    const query = nearbyMiningQuery.parse(req.query);
    const radiusMeters = query.radiusKm * 1000;

    // Bind every user-supplied value positionally — never string-interpolate
    // into raw SQL, even for values already narrowed by zod.
    const params: unknown[] = [query.longitude, query.latitude, req.user!.organizationId, radiusMeters];
    let statusClause = '';
    if (query.status) {
      params.push(query.status);
      statusClause = `AND z.status = $${params.length}::"ZoneStatus"`;
    }
    let commodityClause = '';
    if (query.commodity) {
      params.push(query.commodity);
      commodityClause = `AND z.commodity = $${params.length}`;
    }
    params.push(query.limit);
    const limitParamIndex = params.length;

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        distanceKm: number;
        region: string;
        status: string;
        commodity: string;
        areaKm2: number;
        sourceName: string | null;
        sourceUrl: string | null;
        recordType: string;
        operatorName: string | null;
        productionTonnesPerYear: number | null;
      }>
    >(
      `
      SELECT
        z.id, z.name, z.latitude, z.longitude,
        ST_Distance(z.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS "distanceKm",
        z.region, z.status::text AS status, z.commodity, z."areaKm2",
        z."sourceName", z."sourceUrl", z."recordType"::text AS "recordType",
        z."operatorName", z."productionTonnesPerYear"
      FROM "Zone" z
      JOIN "Mine" m ON m.id = z."mineId"
      WHERE m."organizationId" = $3
        AND ST_DWithin(z.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        ${statusClause}
        ${commodityClause}
      ORDER BY "distanceKm" ASC
      LIMIT $${limitParamIndex}
      `,
      ...params
    );

    const result = rows.map((r) =>
      redactOperationalFields(
        {
          id: r.id,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          distanceKm: Math.round(r.distanceKm * 100) / 100,
          region: r.region,
          status: r.status,
          commodity: r.commodity,
          area: r.areaKm2,
          source: r.sourceName ?? 'MN25 documented records',
          sourceUrl: r.sourceUrl,
          confidence: r.recordType === 'DOCUMENTED_MINE' ? 100 : 70,
          operatorName: r.operatorName,
          productionTonnesPerYear: r.productionTonnesPerYear,
        },
        req.user!.role
      )
    );

    res.json({ results: result, count: result.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/mining/areas — Explore §C
miningRouter.get('/areas', async (req, res, next) => {
  try {
    const query = miningAreasQuery.parse(req.query);
    await syncCanonicalMiningAreas(req.user!.organizationId);
    const bbox = query.bbox ? parseBboxParam(query.bbox) : null;
    if (query.bbox && !bbox) throw new AppError(400, 'invalid_bbox', 'bbox must be "west,south,east,north" with valid ranges.');

    const where: Record<string, unknown> = { mine: { organizationId: req.user!.organizationId } };
    if (query.region) where.region = { contains: query.region, mode: 'insensitive' };
    if (query.state) where.state = { contains: query.state, mode: 'insensitive' };
    if (query.district) where.district = { contains: query.district, mode: 'insensitive' };
    if (query.status) where.status = query.status;
    if (query.commodity) where.commodity = query.commodity;
    if (query.mineType) where.mineType = query.mineType;
    if (bbox) {
      where.latitude = { gte: bbox.south, lte: bbox.north };
      where.longitude = { gte: bbox.west, lte: bbox.east };
    }

    const [rows, total] = await Promise.all([
      prisma.zone.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.offset,
        take: query.limit,
      }),
      prisma.zone.count({ where }),
    ]);

    const results = rows.map((z) =>
      redactOperationalFields(
        {
          id: z.id,
          name: z.name,
          recordType: z.recordType, // DOCUMENTED_MINE | DOCUMENTED_OCCURRENCE — never AI-predicted
          latitude: z.latitude,
          longitude: z.longitude,
          region: z.region,
          state: z.state,
          district: z.district,
          status: z.status,
          commodity: z.commodity,
          mineType: z.mineType,
          area: z.areaKm2,
          operatorName: z.operatorName,
          productionTonnesPerYear: z.productionTonnesPerYear,
          source: z.sourceName ?? 'MN25 documented records',
          sourceUrl: z.sourceUrl,
          lastUpdated: z.updatedAt,
        },
        req.user!.role
      )
    );

    res.json({ results, total, limit: query.limit, offset: query.offset });
  } catch (err) {
    next(err);
  }
});

// GET /api/mining/areas/:id — Explore §D
miningRouter.get('/areas/:id', async (req, res, next) => {
  try {
    const zone = await prisma.zone.findFirst({
      where: { id: req.params.id, mine: { organizationId: req.user!.organizationId } },
      include: { mine: true, mnObservations: { orderBy: { measuredAt: 'desc' }, take: 5, include: { dataSource: true } } },
    });
    if (!zone) throw new AppError(404, 'not_found', 'Mining area not found for this organization.');

    const restricted = req.user!.role === 'RESEARCHER';

    res.json({
      id: zone.id,
      name: zone.name,
      recordType: zone.recordType,
      basicInformation: { mineName: zone.mine.name, status: zone.status, commodity: zone.commodity, mineType: zone.mineType ?? unavailable('Mine type not recorded.') },
      coordinates: { latitude: zone.latitude, longitude: zone.longitude },
      administrativeRegion: { region: zone.region, state: zone.state, district: zone.district },
      commodity: zone.commodity,
      status: zone.status,
      operator: restricted
        ? unavailable('Operator information is restricted for your role.')
        : zone.operatorName ?? unavailable('No authoritative operator record on file.'),
      area: { value: zone.areaKm2, unit: 'km2' },
      production:
        !restricted && zone.productionTonnesPerYear != null
          ? { value: zone.productionTonnesPerYear, unit: 'tonnes/year', source: zone.sourceName ?? null }
          : unavailable(restricted ? 'Production information is restricted for your role.' : 'No authoritative production figures on file.'),
      oreGrade:
        zone.oreGradePercent != null
          ? { value: zone.oreGradePercent, unit: 'percent', source: zone.sourceName ?? null }
          : unavailable('No authoritative ore-grade figure on file.'),
      historicalInformation: zone.mnObservations.length
        ? zone.mnObservations.map((o) => ({ kind: o.kind, concentration: o.concentration, measuredAt: o.measuredAt, source: o.dataSource?.name ?? null }))
        : unavailable('No historical observations on file.'),
      geology: zone.geology ?? unavailable('No geology attributes recorded for this zone.'),
      dataSources: zone.sourceName ? [{ name: zone.sourceName, url: zone.sourceUrl }] : [],
      lastUpdated: zone.updatedAt,
      lastVerifiedAt: zone.lastVerifiedAt ?? unavailable('No verification date recorded.'),
    });
  } catch (err) {
    next(err);
  }
});
