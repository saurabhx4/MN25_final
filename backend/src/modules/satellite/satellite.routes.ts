import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { satelliteScenesQuery } from '../../utils/validation';
import { parseBboxParam } from '../../lib/geo/geometry';
import { getSatelliteProvider } from '../../lib/satellite/satellite.provider';
import { cacheGet, cacheSet } from '../../lib/cache';

export const satelliteRouter = Router();
satelliteRouter.use(requireAuth);

// GET /api/satellite/scenes — Explore §H
// Never invents scene metadata: if no catalog is configured this returns an
// explicit "unavailable" payload instead of demo scenes.
satelliteRouter.get('/scenes', async (req, res, next) => {
  try {
    const query = satelliteScenesQuery.parse(req.query);
    const bbox = parseBboxParam(query.bbox);
    if (!bbox) throw new AppError(400, 'invalid_bbox', 'bbox must be "west,south,east,north" with valid ranges.');

    const provider = getSatelliteProvider();
    if (!provider.configured) {
      return res.json({
        status: 'unavailable',
        reason: `No satellite catalog is configured (set SATELLITE_STAC_URL). No scenes were fabricated.`,
        dataSource: null,
        results: [],
      });
    }

    const cacheKey = `satellite:scenes:${JSON.stringify(query)}`;
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return res.json(cached);

    const scenes = await provider.search({
      bbox,
      startDate: query.startDate,
      endDate: query.endDate,
      maxCloudCoverage: query.cloudCoverage,
      resolution: query.resolution,
    });

    const payload = { results: scenes, count: scenes.length, provider: provider.name };
    await cacheSet(cacheKey, payload, 300);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});
