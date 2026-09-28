import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { getGeocoderProvider } from '../../lib/geocoding/geocoder.provider';
import { placeSearchQuery } from '../../utils/validation';
import { cacheGet, cacheSet } from '../../lib/cache';

export const geospatialRouter = Router();
geospatialRouter.use(requireAuth);

// GET /api/geospatial/search — Explore §A (place search box)
// Combines the org's own documented mining locations (exact/fuzzy name
// match) with an authoritative external geocoder, so "known mining
// locations" and general places both resolve from one box.
geospatialRouter.get('/search', async (req, res, next) => {
  try {
    const query = placeSearchQuery.parse(req.query);
    const cacheKey = `geospatial:search:${JSON.stringify(query)}`;
    const cached = await cacheGet<unknown[]>(cacheKey);
    if (cached) return res.json(cached);

    const [localMatches, geocoded] = await Promise.all([
      prisma.zone.findMany({
        where: {
          mine: { organizationId: req.user!.organizationId },
          OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { region: { contains: query.q, mode: 'insensitive' } }],
          ...(query.region ? { region: { contains: query.region, mode: 'insensitive' } } : {}),
        },
        take: query.limit,
      }),
      getGeocoderProvider()
        .search({ q: query.q, limit: query.limit, country: query.country, region: query.region })
        .catch((err) => {
          req.log?.warn({ err }, 'geocoder_search_failed');
          return [];
        }),
    ]);

    const results = [
      ...localMatches.map((z) => ({
        id: z.id,
        name: z.name,
        type: 'mining_location' as const,
        latitude: z.latitude,
        longitude: z.longitude,
        region: z.region,
        country: null,
        source: z.sourceName ?? 'MN25 documented records',
      })),
      ...geocoded,
    ].slice(0, query.limit);

    await cacheSet(cacheKey, results, 300);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// GET /api/geospatial/layers — Explore §G (map layer manager)
// Availability is derived from actual configuration, never hardcoded to
// "true" — an unconfigured provider is reported as unavailable so the
// frontend layer toggle can reflect reality.
geospatialRouter.get('/layers', async (_req, res, next) => {
  try {
    const satelliteConfigured = Boolean(process.env.SATELLITE_STAC_URL);
    const geologyConfigured = Boolean(process.env.GEOLOGY_LAYER_SOURCE_URL);
    const elevationConfigured = Boolean(process.env.ELEVATION_LAYER_SOURCE_URL);
    const spectralConfigured = Boolean(process.env.SPECTRAL_ENGINE_URL);
    const historicalConfigured = Boolean(process.env.HISTORICAL_IMAGERY_SOURCE_URL);

    const layers = [
      {
        id: 'satellite',
        name: 'Satellite imagery',
        type: 'raster',
        provider: process.env.SATELLITE_PROVIDER_NAME ?? null,
        availability: satelliteConfigured ? 'available' : 'unavailable',
        lastUpdated: null,
        source: satelliteConfigured ? process.env.SATELLITE_PROVIDER_NAME ?? 'Configured STAC catalog' : null,
        sourceUrl: satelliteConfigured ? process.env.SATELLITE_STAC_URL : null,
      },
      {
        id: 'boundaries',
        name: 'State / district boundaries',
        type: 'vector',
        provider: 'OpenStreetMap / Nominatim',
        availability: 'available',
        lastUpdated: null,
        source: 'OpenStreetMap',
        sourceUrl: 'https://www.openstreetmap.org/copyright',
      },
      {
        id: 'geology',
        name: 'Geological formations',
        type: 'vector',
        provider: process.env.GEOLOGY_LAYER_PROVIDER_NAME ?? null,
        availability: geologyConfigured ? 'available' : 'unavailable',
        lastUpdated: null,
        source: geologyConfigured ? process.env.GEOLOGY_LAYER_PROVIDER_NAME ?? 'Configured geology source' : null,
        sourceUrl: geologyConfigured ? process.env.GEOLOGY_LAYER_SOURCE_URL : null,
      },
      {
        id: 'elevation',
        name: 'Elevation / DEM',
        type: 'raster',
        provider: process.env.ELEVATION_LAYER_PROVIDER_NAME ?? null,
        availability: elevationConfigured ? 'available' : 'unavailable',
        lastUpdated: null,
        source: elevationConfigured ? process.env.ELEVATION_LAYER_PROVIDER_NAME ?? 'Configured elevation source' : null,
        sourceUrl: elevationConfigured ? process.env.ELEVATION_LAYER_SOURCE_URL : null,
      },
      {
        id: 'prospectivity',
        name: 'AI prospectivity',
        type: 'vector',
        provider: 'MN25 prospectivity model',
        availability: 'available',
        lastUpdated: null,
        source: 'MN25 ProspectivityZone records',
        sourceUrl: null,
      },
      {
        id: 'miningAreas',
        name: 'Known mining areas',
        type: 'vector',
        provider: 'MN25 documented records',
        availability: 'available',
        lastUpdated: null,
        source: 'MN25 documented mining/deposit records',
        sourceUrl: null,
      },
      {
        id: 'spectralAnomalies',
        name: 'Spectral anomalies',
        type: 'raster',
        provider: process.env.SPECTRAL_ENGINE_URL ? 'Configured spectral engine' : null,
        availability: spectralConfigured ? 'available' : 'unavailable',
        lastUpdated: null,
        source: spectralConfigured ? 'Configured spectral engine' : null,
        sourceUrl: spectralConfigured ? process.env.SPECTRAL_ENGINE_URL : null,
      },
      {
        id: 'historicalImagery',
        name: 'Historical imagery',
        type: 'raster',
        provider: process.env.HISTORICAL_IMAGERY_PROVIDER_NAME ?? null,
        availability: historicalConfigured ? 'available' : 'unavailable',
        lastUpdated: null,
        source: historicalConfigured ? process.env.HISTORICAL_IMAGERY_PROVIDER_NAME ?? 'Configured historical archive' : null,
        sourceUrl: historicalConfigured ? process.env.HISTORICAL_IMAGERY_SOURCE_URL : null,
      },
    ];

    res.json({ layers });
  } catch (err) {
    next(err);
  }
});
