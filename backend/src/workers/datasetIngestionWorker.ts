import { Worker } from 'bullmq';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { recordAudit } from '../modules/audit/audit.service';
import { materializeGeometries, validateDatasetContent, type QualityReport } from '../modules/datasets/dataset.service';

export const datasetIngestionWorker = new Worker('dataset-ingestion-jobs', async job => {
  const { datasetId, organizationId, requestedByUserId } = job.data as { datasetId: string; organizationId: string; requestedByUserId: string };
  const dataset = await prisma.dataset.findFirst({ where: { id: datasetId, organizationId }, include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!dataset) return;
  const version = dataset.versions[0];
  if (!version) throw new Error('Dataset has no immutable version record.');

  try {
    if (job.name === 'validate') {
      await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'VALIDATING', processingError: null } });
      await prisma.datasetVersion.update({ where: { id: version.id }, data: { processingStatus: 'VALIDATING', processingError: null } });
      const report = await validateDatasetContent({ storagePath: version.storagePath, format: version.format, type: dataset.type });
      await persistQuality(dataset.id, version.id, organizationId, requestedByUserId, report);
      if (!report.schemaValidation.valid || !report.coordinateValidation.valid || !report.rangeValidation.valid || !report.geometryValidation.valid) {
        throw new Error('Dataset validation failed. Review validationReport for details.');
      }
      await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'UPLOADED', qualityScore: report.qualityScore, validationReport: report } });
      await prisma.datasetVersion.update({ where: { id: version.id }, data: { processingStatus: 'UPLOADED', qualityScore: report.qualityScore, validationReport: report } });
      await recordAudit({ organizationId, userId: requestedByUserId, action: 'data.dataset.validation.completed', resourceType: 'Dataset', resourceId: dataset.id, metadata: { qualityScore: report.qualityScore } });
      return;
    }

    await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'PROCESSING', processingError: null } });
    await prisma.datasetVersion.update({ where: { id: version.id }, data: { processingStatus: 'PROCESSING', processingError: null } });
    let report = version.validationReport as QualityReport | null;
    if (!report || version.processingStatus !== 'UPLOADED') {
      report = await validateDatasetContent({ storagePath: version.storagePath, format: version.format, type: dataset.type });
      await persistQuality(dataset.id, version.id, organizationId, requestedByUserId, report);
      if (!report.schemaValidation.valid || !report.coordinateValidation.valid || !report.rangeValidation.valid || !report.geometryValidation.valid) throw new Error('Dataset validation failed; processing was not started.');
    }
    await materializeGeometries(dataset.id, version.id, organizationId, version.storagePath, version.format);
    await updateCoverageFromPostgis(dataset.id, organizationId);
    await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'READY', qualityScore: report.qualityScore, validationReport: report, processingError: null } });
    await prisma.datasetVersion.update({ where: { id: version.id }, data: { processingStatus: 'READY', qualityScore: report.qualityScore, validationReport: report, processingError: null } });
    await recordAudit({ organizationId, userId: requestedByUserId, action: 'data.dataset.processing.completed', resourceType: 'Dataset', resourceId: dataset.id, metadata: { qualityScore: report.qualityScore } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dataset ingestion failed.';
    await prisma.dataset.update({ where: { id: dataset.id }, data: { processingStatus: 'FAILED', processingError: message } }).catch(() => undefined);
    await prisma.datasetVersion.update({ where: { id: version.id }, data: { processingStatus: 'FAILED', processingError: message } }).catch(() => undefined);
    await recordAudit({ organizationId, userId: requestedByUserId, action: `data.dataset.${job.name}.failed`, resourceType: 'Dataset', resourceId: dataset.id, metadata: { error: message } });
    throw err;
  }
}, { connection: { url: env.redisUrl }, concurrency: 2 });

async function persistQuality(datasetId: string, datasetVersionId: string, organizationId: string, requestedByUserId: string, report: QualityReport) {
  await prisma.dataQualityRun.create({ data: {
    organizationId, datasetId, datasetVersionId, requestedByUserId, status: 'COMPLETED', schemaValid: report.schemaValidation.valid,
    coordinateValid: report.coordinateValidation.valid, duplicates: report.duplicateDetection.duplicateCount, missingValues: report.missingValueAnalysis.missingCount,
    rangeViolations: report.rangeValidation.violations, geometryValid: report.geometryValidation.valid, qualityScore: report.qualityScore, report, completedAt: new Date(),
  } });
}

datasetIngestionWorker.on('failed', (job, err) => console.error('dataset_ingestion_job_failed', job?.id, err));

async function updateCoverageFromPostgis(datasetId: string, organizationId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ minLon: number | null; minLat: number | null; maxLon: number | null; maxLat: number | null }>>(`SELECT ST_XMin(extent) AS "minLon", ST_YMin(extent) AS "minLat", ST_XMax(extent) AS "maxLon", ST_YMax(extent) AS "maxLat" FROM (SELECT ST_Extent("geometry")::box3d AS extent FROM "DatasetGeometry" WHERE "organizationId"=$1 AND "datasetId"=$2) q`, organizationId, datasetId);
  const r = rows[0];
  if (r?.minLon != null && r?.minLat != null && r?.maxLon != null && r?.maxLat != null) {
    await prisma.dataset.update({ where: { id: datasetId }, data: { coverage: { bbox: [r.minLon, r.minLat, r.maxLon, r.maxLat], crs: 'EPSG:4326' } } });
  }
}
