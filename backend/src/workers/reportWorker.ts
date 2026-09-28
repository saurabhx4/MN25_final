import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { buildReportSnapshot } from '../modules/reports/report.service';
import { renderReportPdf } from '../modules/reports/report.pdf';
import { putReportPdf, checksum } from '../modules/reports/report.storage';
import { recordAudit } from '../modules/audit/audit.service';

const connection = { url: env.redisUrl };

export const reportWorker = new Worker('report-jobs', async job => {
  const { reportId } = job.data as { reportId: string };
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.deletedAt) return;
  await prisma.report.update({ where: { id: reportId }, data: { status: 'GENERATING', errorMessage: null } });
  try {
    const built = await buildReportSnapshot(reportId, report.requestedByUserId);
    const version = report.currentVersion + 1;
    const generatedAt = new Date();
    const pdfSections = (built.content.sections as Array<{title:string; paragraphs?:string[]; rows?:Array<[string,string]>; bullets?:string[]}>).map(s => ({ title: s.title, paragraphs: s.paragraphs, rows: s.rows, bullets: s.bullets }));
    const pdf = await renderReportPdf({ title: report.title, region: String((built.analysisSnapshot as any).subject?.region ?? (built.analysisSnapshot as any).subject?.name ?? report.subjectId), reportId, generatedAt: generatedAt.toISOString(), modelVersion: (built.modelSnapshot as any)?.version ? `${(built.modelSnapshot as any).name} v${(built.modelSnapshot as any).version}` : null }, pdfSections);
    const storageKey = `${report.organizationId}/${report.id}/v${version}.pdf`;
    await putReportPdf(storageKey, pdf);
    const digest = checksum(pdf);
    await prisma.$transaction(async tx => {
      await tx.reportVersion.create({ data: { reportId, version, analysisSnapshot: built.analysisSnapshot, modelSnapshot: built.modelSnapshot, dataSnapshot: built.dataSnapshot, contentSnapshot: built.content, generatedAt, generatedBy: report.requestedByUserId, pdfStorageKey: storageKey, checksum: digest } });
      await tx.report.update({ where: { id: reportId }, data: { status: 'READY', currentVersion: version, completedAt: generatedAt } });
    });
    await recordAudit({ organizationId: report.organizationId, userId: report.requestedByUserId, action: 'reports.generated', resourceType: 'Report', resourceId: reportId, metadata: { version, checksum: digest } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation failed.';
    await prisma.report.update({ where: { id: reportId }, data: { status: 'FAILED', errorMessage: message } });
    await recordAudit({ organizationId: report.organizationId, userId: report.requestedByUserId, action: 'reports.generation_failed', resourceType: 'Report', resourceId: reportId, metadata: { message } });
    throw err;
  }
}, { connection, concurrency: 2 });

reportWorker.on('failed', (job, err) => console.error('report_job_failed', job?.id, err));
