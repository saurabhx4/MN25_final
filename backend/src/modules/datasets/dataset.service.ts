import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import type { DatasetType } from '@prisma/client';
import { objectStorage } from '../../lib/storage/object-storage';
import { objectStorage } from '../../lib/storage/object-storage';

export type QualityReport = {
  schemaValidation: { valid: boolean; errors: string[] };
  coordinateValidation: { valid: boolean; invalidCount: number };
  duplicateDetection: { duplicateCount: number; key: string };
  missingValueAnalysis: { missingCount: number; fields: Record<string, number> };
  rangeValidation: { valid: boolean; violations: number; fields: Record<string, number> };
  geometryValidation: { valid: boolean; invalidCount: number; featureCount: number };
  rowsChecked: number;
  qualityScore: number;
};

const DATASET_TYPES = new Set<string>(['SATELLITE','GEOLOGY','MINING','PRODUCTION','WEATHER','SPECTRAL','SAMPLES','TERRAIN','HISTORICAL_OCCURRENCES']);
const numericRanges: Record<string, [number, number]> = {
  latitude: [-90, 90], longitude: [-180, 180], lat: [-90, 90], lon: [-180, 180],
  lng: [-180, 180], probability: [0, 100], impact: [0, 100], grade: [0, 100],
  oregrade: [0, 100], mnconcentration: [0, 100], rainfall: [0, 100000],
};

export async function ensureDatasetFile(fileBuffer: Buffer, fileName: string, checksum: string): Promise<string> {
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return objectStorage.put(path.join('datasets', checksum.slice(0, 2), `${checksum}-${safeName}`), fileBuffer);
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function readDatasetRecords(storagePath: string | null, format: string | null): Promise<{ records: Record<string, unknown>[]; geoFeatures: Array<{ geometry: Record<string, unknown>; properties?: Record<string, unknown> }> }> {
  if (!storagePath) return { records: [], geoFeatures: [] };
  const raw = await objectStorage.get(storagePath);
  const ext = (format || path.extname(storagePath).replace('.', '')).toLowerCase();
  if (ext === 'json' || ext === 'geojson') {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (isFeatureCollection(parsed)) {
      return {
        records: parsed.features.map(f => ({ ...(f.properties ?? {}), geometry: f.geometry })),
        geoFeatures: parsed.features.filter(f => !!f.geometry).map(f => ({ geometry: f.geometry!, properties: f.properties ?? undefined })),
      };
    }
    if (isFeature(parsed)) return { records: [{ ...(parsed.properties ?? {}), geometry: parsed.geometry }], geoFeatures: parsed.geometry ? [{ geometry: parsed.geometry, properties: parsed.properties ?? undefined }] : [] };
    if (Array.isArray(parsed)) return { records: parsed.filter(isRecord), geoFeatures: [] };
    if (isRecord(parsed)) return { records: [parsed], geoFeatures: [] };
    throw new AppError(422, 'invalid_dataset_schema', 'JSON dataset must contain an object, array, GeoJSON Feature, or FeatureCollection.');
  }
  if (ext === 'csv' || ext === 'txt') return { records: parseCsv(raw.toString('utf8')), geoFeatures: [] };
  return { records: [], geoFeatures: [] };
}

export async function validateDatasetContent(params: { storagePath: string | null; format: string | null; type: DatasetType }): Promise<QualityReport> {
  const { records, geoFeatures } = await readDatasetRecords(params.storagePath, params.format);
  const errors: string[] = [];
  const coordinateIssues = records.reduce((n, r) => n + (hasCoordinateFields(r) && !validCoordinates(r) ? 1 : 0), 0);
  const missingFields: Record<string, number> = {};
  const ranges: Record<string, number> = {};
  const keys = new Set(records.flatMap(r => Object.keys(r)));
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const missing = records.filter(r => r[key] === null || r[key] === undefined || r[key] === '').length;
    if (missing) missingFields[key] = missing;
    const range = numericRanges[normalized];
    if (range) {
      const violations = records.filter(r => {
        const n = Number(r[key]);
        return r[key] !== null && r[key] !== undefined && r[key] !== '' && (!Number.isFinite(n) || n < range[0] || n > range[1]);
      }).length;
      if (violations) ranges[key] = violations;
    }
  }
  const duplicateKeys = records.map(recordKey);
  const counts = new Map<string, number>();
  duplicateKeys.forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1));
  const duplicateCount = [...counts.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);

  const geometryInvalid = geoFeatures.filter(f => !validateGeoJsonGeometry(f.geometry)).length;
  const schemaValid = DATASET_TYPES.has(params.type) && !!params.storagePath && records.length > 0;
  if (!DATASET_TYPES.has(params.type)) errors.push('Unsupported dataset type.');
  if (!params.storagePath) errors.push('Dataset content is not ingested locally; a source URL alone cannot be marked authoritative.');
  else if (records.length === 0) errors.push('No records could be parsed from the uploaded dataset.');
  if (coordinateIssues) errors.push(`${coordinateIssues} records contain invalid coordinates.`);
  if (geometryInvalid) errors.push(`${geometryInvalid} geometries failed GeoJSON validation.`);

  const missingCount = Object.values(missingFields).reduce((a, b) => a + b, 0);
  const rangeViolations = Object.values(ranges).reduce((a, b) => a + b, 0);
  const penalties = Math.min(100, coordinateIssues * 2 + duplicateCount + missingCount * 0.25 + rangeViolations * 2 + geometryInvalid * 3);
  const qualityScore = Math.max(0, Math.round((100 - penalties) * 100) / 100);

  return {
    schemaValidation: { valid: schemaValid && errors.length === 0, errors },
    coordinateValidation: { valid: coordinateIssues === 0, invalidCount: coordinateIssues },
    duplicateDetection: { duplicateCount, key: 'normalized record fields' },
    missingValueAnalysis: { missingCount, fields: missingFields },
    rangeValidation: { valid: rangeViolations === 0, violations: rangeViolations, fields: ranges },
    geometryValidation: { valid: geometryInvalid === 0, invalidCount: geometryInvalid, featureCount: geoFeatures.length },
    rowsChecked: records.length,
    qualityScore,
  };
}

export async function materializeGeometries(datasetId: string, datasetVersionId: string, organizationId: string, storagePath: string | null, format: string | null) {
  const { geoFeatures } = await readDatasetRecords(storagePath, format);
  if (!geoFeatures.length) return 0;
  await prisma.datasetGeometry.deleteMany({ where: { datasetVersionId } });
  let inserted = 0;
  for (let i = 0; i < geoFeatures.length; i++) {
    const feature = geoFeatures[i];
    if (!validateGeoJsonGeometry(feature.geometry)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DatasetGeometry" ("id","organizationId","datasetId","datasetVersionId","featureIndex","properties","geometry","createdAt") VALUES ($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_GeomFromGeoJSON($7),4326),NOW())`,
      crypto.randomUUID(), organizationId, datasetId, datasetVersionId, i, JSON.stringify(feature.properties ?? {}), JSON.stringify(feature.geometry),
    );
    inserted++;
  }
  return inserted;
}

export function validateGeoJsonGeometry(g: Record<string, unknown>): boolean {
  const type = g.type;
  const coords = g.coordinates;
  if (typeof type !== 'string' || !Array.isArray(coords)) return false;
  return validateCoordinatesByType(type, coords);
}

function validateCoordinatesByType(type: string, coords: unknown): boolean {
  if (type === 'Point') return isPosition(coords);
  if (type === 'MultiPoint' || type === 'LineString') return Array.isArray(coords) && coords.length > 0 && coords.every(isPosition);
  if (type === 'MultiLineString') return Array.isArray(coords) && coords.length > 0 && coords.every(c => Array.isArray(c) && c.length > 0 && c.every(isPosition));
  if (type === 'Polygon') return Array.isArray(coords) && coords.length > 0 && coords.every(ring => validRing(ring));
  if (type === 'MultiPolygon') return Array.isArray(coords) && coords.length > 0 && coords.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every((ring: unknown) => validRing(ring)));
  return false;
}

function validRing(v: unknown): boolean {
  if (!Array.isArray(v) || v.length < 4 || !v.every(isPosition)) return false;
  const first = v[0] as number[]; const last = v[v.length - 1] as number[];
  return first[0] === last[0] && first[1] === last[1];
}
function isPosition(v: unknown): boolean {
  if (!Array.isArray(v) || v.length < 2) return false;
  const lon = Number(v[0]); const lat = Number(v[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}
function isFeatureCollection(v: unknown): v is { type: 'FeatureCollection'; features: Array<{ properties?: Record<string, unknown>; geometry: Record<string, unknown> | null }> } { return isRecord(v) && v.type === 'FeatureCollection' && Array.isArray(v.features); }
function isFeature(v: unknown): v is { type: 'Feature'; properties?: Record<string, unknown>; geometry: Record<string, unknown> | null } { return isRecord(v) && v.type === 'Feature'; }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function normalizeKey(k: string) { return k.toLowerCase().replace(/[^a-z]/g, ''); }
function hasCoordinateFields(r: Record<string, unknown>) { return ['latitude','longitude','lat','lon','lng'].some(k => k in r); }
function validCoordinates(r: Record<string, unknown>) {
  const lat = Number(r.latitude ?? r.lat); const lon = Number(r.longitude ?? r.lon ?? r.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
function recordKey(r: Record<string, unknown>) {
  const coords = Object.entries(r).filter(([k]) => /^(id|latitude|longitude|lat|lon|lng|date|timestamp)$/i.test(k));
  return JSON.stringify(coords.length ? coords.sort() : Object.entries(r).sort());
}
function parseCsv(input: string): Record<string, unknown>[] {
  const lines = input.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  if (!headers.length || headers.some(h => !h)) return [];
  return lines.slice(1).map(line => {
    const vals = splitCsvLine(line); const row: Record<string, unknown> = {};
    headers.forEach((h, i) => row[h] = vals[i] ?? '');
    return row;
  });
}
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

export async function linkAnalysisDatasets(analysisJobId: string, organizationId: string, datasetIds: string[] | undefined) {
  let ids = [...new Set(datasetIds ?? [])];
  if (!ids.length) {
    const ready = await prisma.dataset.findMany({
      where: { organizationId, processingStatus: 'READY' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, version: true, type: true },
    });
    const latestByType = new Map<string, typeof ready[number]>();
    for (const dataset of ready) if (!latestByType.has(dataset.type)) latestByType.set(dataset.type, dataset);
    ids = [...latestByType.values()].map(d => d.id);
  }
  try {
    if (!ids.length) throw new AppError(409, 'data_unavailable', 'No READY authoritative datasets are available for this analysis. Ingest and process a dataset first.');
    const datasets = await prisma.dataset.findMany({ where: { id: { in: ids }, organizationId, processingStatus: 'READY' }, select: { id: true, version: true } });
    if (datasets.length !== ids.length) throw new AppError(409, 'dataset_not_ready', 'One or more requested datasets are missing, belong to another organization, or are not READY.');
    for (const dataset of datasets) {
      const version = await prisma.datasetVersion.findUnique({ where: { datasetId_version: { datasetId: dataset.id, version: dataset.version } } });
      if (!version || version.processingStatus !== 'READY') throw new AppError(409, 'dataset_version_not_ready', 'The selected dataset version is not READY.');
      await prisma.analysisDatasetLink.upsert({
        where: { analysisJobId_datasetId_datasetVersionId: { analysisJobId, datasetId: dataset.id, datasetVersionId: version.id } },
        create: { organizationId, analysisJobId, datasetId: dataset.id, datasetVersionId: version.id, role: 'input' },
        update: {},
      });
    }
  } catch (err) {
    await prisma.analysisJob.update({ where: { id: analysisJobId }, data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Dataset provenance validation failed.' } }).catch(() => undefined);
    throw err;
  }
}
