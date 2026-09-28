import { z } from 'zod';

export const topZonesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  mineId: z.string().uuid().optional(),
  region: z.string().min(1).optional(),
  minimumProspectivity: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(['prospectivity', 'confidence', 'predictedMn']).optional(),
});

export const mnDistributionQuery = z.object({
  mineId: z.string().uuid().optional(),
  region: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  resolution: z.enum(['day', 'week', 'month']).optional(),
});

export const newAnalysisBody = z.object({
  zoneId: z.string().uuid().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  analysisType: z.enum(['PROSPECTIVITY', 'REGION_COMPARISON', 'SPECTRAL']),
  mineId: z.string().uuid().optional(),
  datasetIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const comparisonBody = z.object({
  zoneIds: z.array(z.string().uuid()).min(2).max(8),
  datasetIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const reportBody = z.object({
  subjectType: z.enum(['analysis', 'region', 'mine', 'hotspot']),
  subjectId: z.string().min(1).max(120),
  reportType: z.enum(['quick', 'detailed', 'prospectivity']),
  sections: z.array(z.enum(['summary', 'maps', 'mining', 'geology', 'ai', 'spectral', 'model', 'sources', 'limits'])).min(1),
  analysisIds: z.array(z.string().uuid()).default([]),
});

export const reportListQuery = z.object({
  type: z.enum(['quick', 'detailed', 'prospectivity']).optional(),
  subject: z.string().min(1).max(120).optional(),
  date: z.string().datetime().optional(),
  status: z.enum(['QUEUED', 'GENERATING', 'READY', 'FAILED']).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Explore page (geospatial / mining / prospectivity / satellite)
// ---------------------------------------------------------------------------

export const placeSearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
  country: z.string().length(2).optional(),
  region: z.string().min(1).max(120).optional(),
});

const zoneStatusEnum = z.enum(['AVAILABLE', 'ACTIVE_EXTRACTION', 'MONITORING', 'RESTRICTED']);

export const nearbyMiningQuery = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(2000).optional().default(100),
  status: zoneStatusEnum.optional(),
  commodity: z.string().min(1).max(60).optional().default('manganese'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const miningAreasQuery = z.object({
  region: z.string().min(1).max(120).optional(),
  state: z.string().min(1).max(120).optional(),
  district: z.string().min(1).max(120).optional(),
  status: zoneStatusEnum.optional(),
  commodity: z.string().min(1).max(60).optional(),
  bbox: z.string().optional(),
  mineType: z.string().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const hotspotsQuery = z.object({
  region: z.string().min(1).max(120).optional(),
  bbox: z.string().optional(),
  minimumScore: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  sortBy: z.enum(['prospectivity', 'confidence', 'generatedAt']).optional().default('prospectivity'),
  modelVersion: z.string().min(1).max(60).optional(),
});

export const satelliteScenesQuery = z.object({
  bbox: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  cloudCoverage: z.coerce.number().min(0).max(100).optional(),
  provider: z.string().min(1).max(60).optional(),
  resolution: z.string().min(1).max(20).optional(),
});

const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()).min(2))),
});

export const regionAnalysisBody = z.object({
  geometry: geoJsonPolygonSchema,
  analysisType: z.enum(['PROSPECTIVITY', 'REGION_COMPARISON', 'SPECTRAL', 'REGION_SCAN']).optional().default('REGION_SCAN'),
  requestedLayers: z.array(z.string()).optional(),
  datasetIds: z.array(z.string().uuid()).max(50).optional().default([]),
  modelVersion: z.string().min(1).max(60).optional(),
});

// ---------------------------------------------------------------------------
// AI Analysis page (Overview / Region / Spectral / Model Insights / Samples)
// ---------------------------------------------------------------------------

export const aiAnalysisCreateBody = z.object({
  subjectType: z.enum(['zone', 'region']),
  subjectId: z.string().uuid().optional(), // required when subjectType === 'zone'
  geometry: geoJsonPolygonSchema.optional(), // required when subjectType === 'region'
  modelVersion: z.string().min(1).max(60).optional(),
  requestedAnalyses: z.array(z.enum(['prospectivity', 'spectral', 'uncertainty', 'explainability'])).optional().default(['prospectivity']),
  datasetIds: z.array(z.string().uuid()).max(50).optional().default([]),
}).refine((v) => (v.subjectType === 'zone' ? !!v.subjectId : !!v.geometry), {
  message: 'subjectId is required for subjectType "zone"; geometry is required for subjectType "region".',
});

export const spectralAnalysisBody = z.object({
  sceneId: z.string().min(1).max(120).optional(),
  geometry: geoJsonPolygonSchema.optional(),
  bandConfiguration: z.object({
    bands: z.array(z.string()).optional(),
    indices: z.array(z.string()).optional(),
  }).optional(),
}).refine((v) => !!v.sceneId || !!v.geometry, {
  message: 'Provide either sceneId or geometry to identify the scene to analyze.',
});

export const groundTruthSampleBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  collectionDate: z.string().datetime(),
  mnConcentration: z.number().min(0).max(100),
  measurementMethod: z.string().min(1).max(80),
  laboratory: z.string().min(1).max(120).optional(),
  quality: z.enum(['verified', 'provisional', 'flagged']).optional().default('provisional'),
  source: z.string().min(1).max(120).optional(),
  mineId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(), // ProspectivityZone id, if this sample validates a specific AI region
});

export const samplesListQuery = z.object({
  kind: z.enum(['FILE_UPLOAD', 'GROUND_TRUTH']).optional(),
  regionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const modelValidationBody = z.object({
  modelVersion: z.string().min(1).max(60),
  sampleIds: z.array(z.string().uuid()).min(1).max(500),
  regionId: z.string().uuid().optional(),
});

export const saveMapConfigurationBody = z.object({
  name: z.string().min(1).max(120),
  layers: z.record(z.boolean()),
  mapView: z.object({ centerLat: z.number(), centerLng: z.number(), zoom: z.number() }).optional(),
});
