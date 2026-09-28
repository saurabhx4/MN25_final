import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import type { DatasetType, DatasetProcessingStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../audit/audit.service';
import { ensureDatasetFile, sha256 } from './dataset.service';

export const datasetsRouter = Router();
datasetsRouter.use(requireAuth);
const queue = new Queue('dataset-ingestion-jobs', { connection: { url: env.redisUrl } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.DATASET_MAX_UPLOAD_BYTES ?? 250 * 1024 * 1024) } });

const typeSchema = z.enum(['satellite','geology','mining','production','weather','spectral','samples','terrain','historicalOccurrences']);
const createBody = z.object({
  name: z.string().trim().min(1).max(200), type: typeSchema, provider: z.string().trim().min(1).max(160), sourceUrl: z.string().url().max(2000),
  version: z.string().trim().min(1).max(80), coverage: z.unknown().optional(), acquisitionDate: z.string().datetime().optional(), license: z.string().max(500).optional(), mineId: z.string().uuid().optional(),
});
const listQuery = z.object({ type: typeSchema.optional(), status: z.enum(['uploaded','validating','processing','ready','failed']).optional(), mineId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });

const typeMap: Record<string, string> = { satellite:'SATELLITE', geology:'GEOLOGY', mining:'MINING', production:'PRODUCTION', weather:'WEATHER', spectral:'SPECTRAL', samples:'SAMPLES', terrain:'TERRAIN', historicalOccurrences:'HISTORICAL_OCCURRENCES' };
const statusMap: Record<string, string> = { UPLOADED:'uploaded', VALIDATING:'validating', PROCESSING:'processing', READY:'ready', FAILED:'failed' };

// POST /api/datasets — creates a logical dataset or an explicit new version.
datasetsRouter.post('/', requirePermission('data.upload'), upload.single('file'), async (req, res, next) => {
  try {
    const body = createBody.parse(req.body);
    const type = typeMap[body.type] as DatasetType;
    if (body.mineId) {
      const mine = await prisma.mine.findFirst({ where: { id: body.mineId, organizationId: req.user!.organizationId } });
      if (!mine) throw new AppError(404, 'not_found', 'Mine does not belong to the authenticated organization.');
    }
    const file = req.file;
    if (!file && !body.sourceUrl) throw new AppError(400, 'invalid_request', 'sourceUrl or an uploaded file is required.');
    const checksum = file ? sha256(file.buffer) : sha256(Buffer.from(`${body.sourceUrl}|${body.version}`));
    const format = file ? path.extname(file.originalname).replace('.', '').toLowerCase() || null : null;
    const storagePath = file ? await ensureDatasetFile(file.buffer, file.originalname, checksum) : null;

    const existing = await prisma.dataset.findFirst({ where: { organizationId: req.user!.organizationId, name: body.name, type } });
    if (existing) {
      const sameVersion = await prisma.datasetVersion.findUnique({ where: { datasetId_version: { datasetId: existing.id, version: body.version } } });
      if (sameVersion) throw new AppError(409, 'dataset_version_exists', 'This dataset version already exists; create a new version instead of overwriting it.');
    }

    const result = await prisma.$transaction(async tx => {
      const dataset = existing ?? await tx.dataset.create({ data: {
        organizationId: req.user!.organizationId, mineId: body.mineId, createdByUserId: req.user!.id, name: body.name, type,
        provider: body.provider, sourceUrl: body.sourceUrl, version: body.version, coverage: body.coverage, acquisitionDate: body.acquisitionDate ? new Date(body.acquisitionDate) : undefined,
        license: body.license, checksum, format, contentType: file?.mimetype, sizeBytes: file?.size, storagePath,
      }});
      const version = await tx.datasetVersion.create({ data: {
        datasetId: dataset.id, organizationId: req.user!.organizationId, createdByUserId: req.user!.id, version: body.version, provider: body.provider,
        sourceUrl: body.sourceUrl, coverage: body.coverage, acquisitionDate: body.acquisitionDate ? new Date(body.acquisitionDate) : undefined, license: body.license,
        checksum, format, contentType: file?.mimetype, sizeBytes: file?.size, storagePath,
      }});
      if (existing) await tx.dataset.update({ where: { id: existing.id }, data: {
        mineId: body.mineId ?? existing.mineId, provider: body.provider, sourceUrl: body.sourceUrl, version: body.version, coverage: body.coverage,
        acquisitionDate: body.acquisitionDate ? new Date(body.acquisitionDate) : undefined, license: body.license, checksum, format, contentType: file?.mimetype,
        sizeBytes: file?.size, storagePath, processingStatus: 'UPLOADED', qualityScore: null, validationReport: null, processingError: null,
      }});
      return { dataset, version };
    });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'data.dataset.created', resourceType: 'Dataset', resourceId: result.dataset.id, metadata: { version: result.version.version, type: result.dataset.type, checksum } });
    res.status(201).json(serializeDataset(result.dataset, result.version));
  } catch (err) { next(err); }
});

datasetsRouter.get('/', requirePermission('data.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const where: Prisma.DatasetWhereInput = { organizationId: req.user!.organizationId };
    if (q.type) where.type = typeMap[q.type] as DatasetType;
    if (q.status) where.processingStatus = q.status.toUpperCase() as DatasetProcessingStatus;
    if (q.mineId) where.mineId = q.mineId;
    const [results,total] = await Promise.all([prisma.dataset.findMany({ where, orderBy: { updatedAt: 'desc' }, take: q.limit, skip: q.offset }), prisma.dataset.count({ where })]);
    res.json({ results: results.map(serializeDataset), total, limit: q.limit, offset: q.offset });
  } catch (err) { next(err); }
});

datasetsRouter.get('/:id', requirePermission('data.read'), async (req, res, next) => {
  try {
    const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, include: { versions: { orderBy: { createdAt: 'desc' } } } });
    if (!dataset) throw new AppError(404, 'not_found', 'Dataset not found.');
    res.json({ ...serializeDataset(dataset), versions: dataset.versions.map(v => ({ ...serializeVersion(v), sizeBytes: v.sizeBytes?.toString() ?? null })) });
  } catch (err) { next(err); }
});

datasetsRouter.post('/:id/validate', requirePermission('data.upload'), async (req, res, next) => {
  try {
    const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!dataset) throw new AppError(404, 'not_found', 'Dataset not found.');
    await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'VALIDATING', processingError: null } });
    await queue.add('validate', { datasetId: dataset.id, organizationId: req.user!.organizationId, requestedByUserId: req.user!.id }, { removeOnComplete: 100, removeOnFail: 100 });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'data.dataset.validation.requested', resourceType: 'Dataset', resourceId: dataset.id });
    res.status(202).json({ datasetId: dataset.id, status: 'validating' });
  } catch (err) { next(err); }
});

datasetsRouter.post('/:id/process', requirePermission('data.upload'), async (req, res, next) => {
  try {
    const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!dataset) throw new AppError(404, 'not_found', 'Dataset not found.');
    if (dataset.processingStatus === 'PROCESSING') return res.status(409).json({ error: 'already_processing' });
    await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'PROCESSING', processingError: null } });
    await queue.add('process', { datasetId: dataset.id, organizationId: req.user!.organizationId, requestedByUserId: req.user!.id }, { removeOnComplete: 100, removeOnFail: 100 });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'data.dataset.processing.requested', resourceType: 'Dataset', resourceId: dataset.id });
    res.status(202).json({ datasetId: dataset.id, status: 'processing' });
  } catch (err) { next(err); }
});

// GET /api/datasets/:id/provenance — datasets and versions linked to analyses in this tenant.
datasetsRouter.get('/:id/provenance', requirePermission('data.read'), async (req, res, next) => {
  try {
    const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!dataset) throw new AppError(404, 'not_found', 'Dataset not found.');
    const links = await prisma.analysisDatasetLink.findMany({ where: { datasetId: dataset.id, organizationId: req.user!.organizationId }, include: { datasetVersion: true, analysisJob: { select: { id: true, analysisType: true, status: true, createdAt: true, completedAt: true, requestedByUserId: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({ datasetId: dataset.id, dataset: serializeDataset(dataset), analyses: links.map(l => ({ analysisId: l.analysisJob.id, analysisType: l.analysisJob.analysisType, status: l.analysisJob.status, requestedByUserId: l.analysisJob.requestedByUserId, createdAt: l.analysisJob.createdAt, completedAt: l.analysisJob.completedAt, role: l.role, datasetVersion: l.datasetVersion ? serializeVersion(l.datasetVersion) : null })) });
  } catch (err) { next(err); }
});

// Spatial query surface backed by PostGIS. It is intentionally tenant-scoped.
datasetsRouter.get('/:id/spatial', requirePermission('data.read'), async (req, res, next) => {
  try {
    const dataset = await prisma.dataset.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!dataset) throw new AppError(404, 'not_found', 'Dataset not found.');
    const lat = req.query.latitude !== undefined ? Number(req.query.latitude) : null;
    const lon = req.query.longitude !== undefined ? Number(req.query.longitude) : null;
    const radiusKm = Number(req.query.radiusKm ?? 10);
    if (lat !== null || lon !== null) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat! < -90 || lat! > 90 || lon! < -180 || lon! > 180) throw new AppError(400, 'invalid_coordinates', 'Valid latitude and longitude are required.');
      if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 2000) throw new AppError(400, 'invalid_radius', 'radiusKm must be between 0 and 2000.');
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; featureIndex: number; properties: unknown; distanceMeters: number }>>(`SELECT "id", "featureIndex", "properties", ST_Distance("geometry"::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS "distanceMeters" FROM "DatasetGeometry" WHERE "organizationId"=$3 AND "datasetId"=$4 AND ST_DWithin("geometry"::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$5) ORDER BY "distanceMeters" ASC LIMIT 200`, lon, lat, req.user!.organizationId, dataset.id, radiusKm * 1000);
      return res.json({ query: { latitude: lat, longitude: lon, radiusKm }, results: rows });
    }
    const bbox = String(req.query.bbox ?? '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n))) throw new AppError(400, 'invalid_spatial_query', 'Provide latitude/longitude/radiusKm or bbox=minLon,minLat,maxLon,maxLat.');
    const [minLon,minLat,maxLon,maxLat] = bbox;
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; featureIndex: number; properties: unknown }>>(`SELECT "id", "featureIndex", "properties" FROM "DatasetGeometry" WHERE "organizationId"=$1 AND "datasetId"=$2 AND ST_Intersects("geometry", ST_MakeEnvelope($3,$4,$5,$6,4326)) LIMIT 500`, req.user!.organizationId, dataset.id, minLon,minLat,maxLon,maxLat);
    res.json({ query: { bbox: [minLon,minLat,maxLon,maxLat] }, results: rows });
  } catch (err) { next(err); }
});

type DatasetLike = { id: string; name: string; type: DatasetType; provider: string; sourceUrl: string; version: string; coverage: unknown; acquisitionDate: Date | null; ingestionDate: Date; processingStatus: string; qualityScore: number | null; license: string | null; checksum: string; mineId: string | null; format: string | null; contentType: string | null; sizeBytes: bigint | null; validationReport: unknown; processingError: string | null; createdAt: Date; updatedAt: Date };
type DatasetVersionLike = { id: string; version: string; provider: string; sourceUrl: string; coverage: unknown; acquisitionDate: Date | null; ingestionDate: Date; processingStatus: string; qualityScore: number | null; license: string | null; checksum: string; format: string | null; contentType: string | null; sizeBytes: bigint | null; validationReport: unknown; processingError: string | null; createdAt: Date };
function serializeDataset(d: DatasetLike, v?: { id: string } | null) { return { id: d.id, name: d.name, type: serializeType(d.type), provider: d.provider, sourceUrl: d.sourceUrl, version: d.version, coverage: d.coverage, acquisitionDate: d.acquisitionDate, ingestionDate: d.ingestionDate, processingStatus: statusMap[d.processingStatus] ?? d.processingStatus, qualityScore: d.qualityScore, license: d.license, checksum: d.checksum, mineId: d.mineId, format: d.format, contentType: d.contentType, sizeBytes: d.sizeBytes?.toString() ?? null, validationReport: d.validationReport, processingError: d.processingError, createdAt: d.createdAt, updatedAt: d.updatedAt, versionId: v?.id ?? null }; }
function serializeType(type: string): string { const map: Record<string,string> = { SATELLITE:'satellite', GEOLOGY:'geology', MINING:'mining', PRODUCTION:'production', WEATHER:'weather', SPECTRAL:'spectral', SAMPLES:'samples', TERRAIN:'terrain', HISTORICAL_OCCURRENCES:'historicalOccurrences' }; return map[type] ?? type.toLowerCase(); }
function serializeVersion(v: DatasetVersionLike) { return { id: v.id, version: v.version, provider: v.provider, sourceUrl: v.sourceUrl, coverage: v.coverage, acquisitionDate: v.acquisitionDate, ingestionDate: v.ingestionDate, processingStatus: statusMap[v.processingStatus] ?? v.processingStatus, qualityScore: v.qualityScore, license: v.license, checksum: v.checksum, format: v.format, contentType: v.contentType, sizeBytes: v.sizeBytes?.toString() ?? null, validationReport: v.validationReport, processingError: v.processingError, createdAt: v.createdAt }; }
