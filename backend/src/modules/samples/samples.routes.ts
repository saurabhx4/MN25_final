import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { AppError } from '../../middleware/errorHandler';
import { groundTruthSampleBody, samplesListQuery } from '../../utils/validation';

export const samplesRouter = Router();
samplesRouter.use(requireAuth);

// POST /api/samples — Data & Samples tab: register a ground-truth lab/field
// measurement so it can later back a real GET /api/model-validation run.
// This is intentionally a distinct code path from /upload (file ingestion) —
// a Sample row here always carries an actual measured Mn concentration.
samplesRouter.post('/', async (req, res, next) => {
  try {
    const body = groundTruthSampleBody.parse(req.body);

    if (body.regionId) {
      const region = await prisma.prospectivityZone.findFirst({
        where: { id: body.regionId, OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] },
      });
      if (!region) throw new AppError(404, 'not_found', 'regionId does not reference a known analysis region.');
    }

    const sample = await prisma.sample.create({
      data: {
        organizationId: req.user!.organizationId,
        mineId: body.mineId,
        uploadedByUserId: req.user!.id,
        kind: 'GROUND_TRUTH',
        status: 'INGESTED',
        latitude: body.latitude,
        longitude: body.longitude,
        collectionDate: new Date(body.collectionDate),
        mnConcentration: body.mnConcentration,
        measurementMethod: body.measurementMethod,
        laboratory: body.laboratory,
        quality: body.quality,
        source: body.source,
        regionId: body.regionId,
      },
    });

    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'ai_analysis.samples.ground_truth.created',
      resourceType: 'Sample',
      resourceId: sample.id,
      metadata: { mnConcentration: sample.mnConcentration, regionId: sample.regionId },
    });

    res.status(201).json({ sampleId: sample.id, status: sample.status });
  } catch (err) {
    next(err);
  }
});

// GET /api/samples — Data & Samples tab: sample table.
samplesRouter.get('/', async (req, res, next) => {
  try {
    const query = samplesListQuery.parse(req.query);
    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (query.kind) where.kind = query.kind;
    if (query.regionId) where.regionId = query.regionId;

    const [results, total] = await Promise.all([
      prisma.sample.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset }),
      prisma.sample.count({ where }),
    ]);

    res.json({
      results: results.map(serializeSample),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/samples/:id
samplesRouter.get('/:id', async (req, res, next) => {
  try {
    const sample = await prisma.sample.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!sample) throw new AppError(404, 'not_found', 'Sample not found.');
    res.json(serializeSample(sample));
  } catch (err) {
    next(err);
  }
});

function serializeSample(s: {
  id: string; kind: string; status: string; fileName: string | null; storageUrl: string | null;
  latitude: number | null; longitude: number | null; collectionDate: Date | null; mnConcentration: number | null;
  measurementMethod: string | null; laboratory: string | null; quality: string | null; source: string | null;
  regionId: string | null; createdAt: Date;
}) {
  return {
    sampleId: s.id,
    kind: s.kind,
    status: s.status,
    fileName: s.fileName,
    location: s.latitude !== null && s.longitude !== null ? { latitude: s.latitude, longitude: s.longitude } : null,
    collectionDate: s.collectionDate,
    mnConcentration: s.mnConcentration,
    measurementMethod: s.measurementMethod,
    laboratory: s.laboratory,
    quality: s.quality,
    source: s.source,
    regionId: s.regionId,
    createdAt: s.createdAt,
  };
}

// Files land in object storage (S3/GCS in production); this upload handler
// only validates and stores the pointer + metadata. Swap `storeFile` for a
// real object-storage client — never invent a storage URL if the upload fails.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function storeFile(buffer: Buffer, fileName: string): Promise<string> {
  // Placeholder for the real object-storage integration (S3/GCS/Azure Blob).
  // Throwing here rather than fabricating a URL keeps failures honest.
  throw new AppError(501, 'storage_not_configured', 'Object storage is not configured in this environment.');
}

samplesRouter.post('/upload', requirePermission('data.upload'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'invalid_request', 'No file provided.');
    const { mineId } = req.body as { mineId?: string };

    let storageUrl: string;
    try {
      storageUrl = await storeFile(req.file.buffer, req.file.originalname);
    } catch (storageErr) {
      // Record the attempt so it's auditable, but report failure honestly.
      throw storageErr;
    }

    const sample = await prisma.sample.create({
      data: {
        organizationId: req.user!.organizationId,
        mineId,
        uploadedByUserId: req.user!.id,
        fileName: req.file.originalname,
        storageUrl,
        status: 'UPLOADED',
      },
    });

    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'dashboard.upload_samples',
      resourceType: 'Sample',
      resourceId: sample.id,
      metadata: { fileName: sample.fileName },
    });

    res.status(201).json({ sampleId: sample.id, status: sample.status });
  } catch (err) {
    next(err);
  }
});
