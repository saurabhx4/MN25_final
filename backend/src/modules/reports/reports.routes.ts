import { Router } from 'express';
import { Queue } from 'bullmq';
import { requireAuth, requirePermission, type AuthUser } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { reportBody, reportListQuery } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { buildReportSnapshot } from './report.service';
import { getReportPdf, reportDownloadToken, verifyReportDownloadToken } from './report.storage';

export const reportsRouter = Router();
export const reportQueue = new Queue('report-jobs', { connection: { url: env.redisUrl } });

function canUseToken(req: Parameters<typeof requireAuth>[0]): { user?: AuthUser; versionId?: string } {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return {};
  const verified = verifyReportDownloadToken(token, req.params.id);
  return verified ? { versionId: verified.versionId } : {};
}

reportsRouter.post('/', requireAuth, requirePermission('reports.generate'), async (req, res, next) => {
  try {
    const body = reportBody.parse(req.body);
    const orgId = req.user!.organizationId;
    if (body.analysisIds.length) {
      const count = await prisma.analysisJob.count({ where: { id: { in: body.analysisIds }, organizationId: orgId } });
      if (count !== body.analysisIds.length) throw new AppError(404, 'not_found', 'One or more analysis IDs are not available to this organization.');
    }
    if (body.subjectType === 'analysis') {
      const analysis = await prisma.analysisJob.findFirst({ where: { id: body.subjectId, organizationId: orgId } });
      const zoneFallback = !analysis ? await prisma.zone.findFirst({ where: { id: body.subjectId, mine: { organizationId: orgId } } }) : null;
      if (!analysis && !zoneFallback) throw new AppError(404, 'not_found', 'Analysis subject not found.');
    } else if (body.subjectType === 'hotspot') {
      const hotspot = await prisma.prospectivityZone.findFirst({ where: { id: body.subjectId, OR: [{ organizationId: orgId }, { organizationId: null }] } });
      const zoneFallback = !hotspot ? await prisma.zone.findFirst({ where: { id: body.subjectId, mine: { organizationId: orgId } } }) : null;
      if (!hotspot && !zoneFallback) throw new AppError(404, 'not_found', 'Hotspot subject not found.');
    } else {
      const zone = await prisma.zone.findFirst({ where: { id: body.subjectId, mine: { organizationId: orgId } } });
      if (!zone) throw new AppError(404, 'not_found', 'Region/mining-area subject not found.');
    }

    const titleBase = body.reportType === 'quick' ? 'Quick Exploration Report' : body.reportType === 'prospectivity' ? 'AI Prospectivity Report' : 'Detailed Exploration Report';
    const subjectName = body.subjectType === 'hotspot'
      ? (await prisma.prospectivityZone.findUnique({ where: { id: body.subjectId }, select: { region: true } }))?.region
      : (await prisma.zone.findFirst({ where: { id: body.subjectId, mine: { organizationId: orgId } }, select: { name: true, region: true } }))?.name;
    const title = subjectName ? `${titleBase} — ${subjectName}` : titleBase;
    const report = await prisma.report.create({
      data: { organizationId: orgId, requestedByUserId: req.user!.id, title, subjectType: body.subjectType, subjectId: body.subjectId, reportType: body.reportType, sections: body.sections, analysisIds: body.analysisIds, status: 'QUEUED' },
    });
    await reportQueue.add('generate-report', { reportId: report.id });
    await recordAudit({ organizationId: orgId, userId: req.user!.id, action: 'reports.created', resourceType: 'Report', resourceId: report.id, metadata: body });
    res.status(202).json({ reportId: report.id, status: report.status });
  } catch (err) { next(err); }
});

reportsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = reportListQuery.parse(req.query);
    const where: any = { organizationId: req.user!.organizationId, deletedAt: null };
    if (q.type) where.reportType = q.type;
    if (q.status) where.status = q.status;
    if (q.subject) where.OR = [{ subjectId: q.subject }, { title: { contains: q.subject, mode: 'insensitive' } }];
    if (q.date) where.createdAt = { gte: new Date(q.date) };
    if (q.q) where.OR = [{ id: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { subjectId: { contains: q.q, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.offset, take: q.limit, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }),
      prisma.report.count({ where }),
    ]);
    res.json({ results: rows.map(r => ({ id: r.id, title: r.title, subjectType: r.subjectType, subjectId: r.subjectId, reportType: r.reportType, sections: r.sections, analysisIds: r.analysisIds, status: r.status, currentVersion: r.currentVersion, createdAt: r.createdAt, updatedAt: r.updatedAt, completedAt: r.completedAt, errorMessage: r.errorMessage, version: r.versions[0] ? { id: r.versions[0].id, version: r.versions[0].version, generatedAt: r.versions[0].generatedAt, checksum: r.versions[0].checksum } : null })), total, limit: q.limit, offset: q.offset });
  } catch (err) { next(err); }
});

reportsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!report) throw new AppError(404, 'not_found', 'Report not found.');
    res.json(report);
  } catch (err) { next(err); }
});

reportsRouter.get('/:id/versions', requireAuth, async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null }, select: { id: true } });
    if (!report) throw new AppError(404, 'not_found', 'Report not found.');
    const versions = await prisma.reportVersion.findMany({ where: { reportId: report.id }, orderBy: { version: 'desc' }, select: { id: true, version: true, generatedAt: true, generatedBy: true, pdfStorageKey: true, checksum: true } });
    res.json({ results: versions });
  } catch (err) { next(err); }
});

reportsRouter.get('/:id/preview', requireAuth, async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!report) throw new AppError(404, 'not_found', 'Report not found.');
    if (report.status !== 'READY' || !report.versions[0]) return res.status(409).json({ error: 'not_ready', status: report.status, message: report.errorMessage ?? 'Report is not ready.' });
    res.json({ reportId: report.id, version: report.versions[0].version, title: report.title, reportType: report.reportType, content: report.versions[0].contentSnapshot, analysisSnapshot: report.versions[0].analysisSnapshot, modelSnapshot: report.versions[0].modelSnapshot, dataSnapshot: report.versions[0].dataSnapshot });
  } catch (err) { next(err); }
});

reportsRouter.post('/:id/generate-pdf', requireAuth, requirePermission('reports.generate'), async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null } });
    if (!report) throw new AppError(404, 'not_found', 'Report not found.');
    await prisma.report.update({ where: { id: report.id }, data: { status: 'QUEUED', errorMessage: null } });
    await reportQueue.add('generate-report', { reportId: report.id, reason: 'pdf-regeneration' });
    await recordAudit({ organizationId: report.organizationId, userId: req.user!.id, action: 'reports.versioned', resourceType: 'Report', resourceId: report.id, metadata: { reason: 'pdf-regeneration' } });
    res.status(202).json({ reportId: report.id, status: 'QUEUED' });
  } catch (err) { next(err); }
});

reportsRouter.get('/:id/download', async (req, res, next) => {
  try {
    const tokenAccess = canUseToken(req);
    let report = null as any;
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = await import('jsonwebtoken');
        const payload = jwt.default.verify(authHeader.slice(7), env.jwtSecret) as AuthUser;
        report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: payload.organizationId, deletedAt: null } });
        userId = payload.id;
      } catch { /* token path may still be valid */ }
    }
    if (!report && tokenAccess.versionId) {
      report = await prisma.report.findFirst({ where: { id: req.params.id, deletedAt: null } });
    }
    if (!report) throw new AppError(401, 'unauthorized', 'A valid authentication or temporary report token is required.');
    const versionId = tokenAccess.versionId ?? (report.currentVersion ? (await prisma.reportVersion.findFirst({ where: { reportId: report.id, version: report.currentVersion } }))?.id : null);
    if (!versionId) throw new AppError(404, 'not_found', 'No generated PDF exists for this report.');
    const version = await prisma.reportVersion.findFirst({ where: { id: versionId, reportId: report.id } });
    if (!version?.pdfStorageKey) throw new AppError(404, 'not_found', 'PDF is unavailable for this report version.');
    await recordAudit({ organizationId: report.organizationId, userId: userId ?? report.requestedByUserId, action: 'reports.downloaded', resourceType: 'Report', resourceId: report.id, metadata: { version: version.version, access: userId ? 'bearer' : 'temporary-token' } });
    const bytes = await getReportPdf(version.pdfStorageKey);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="MN25-${report.id}-v${version.version}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  } catch (err) { next(err); }
});

reportsRouter.get('/:id/download-url', requireAuth, async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null } });
    if (!report || !report.currentVersion) throw new AppError(404, 'not_found', 'Generated report version not found.');
    const version = await prisma.reportVersion.findFirst({ where: { reportId: report.id, version: report.currentVersion } });
    if (!version?.pdfStorageKey) throw new AppError(404, 'not_found', 'PDF is unavailable.');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const token = reportDownloadToken(report.id, version.id, expiresAt);
    await recordAudit({ organizationId: report.organizationId, userId: req.user!.id, action: 'reports.download_url.created', resourceType: 'Report', resourceId: report.id, metadata: { version: version.version, expiresAt } });
    res.json({ url: `/api/reports/${report.id}/download?token=${encodeURIComponent(token)}`, expiresAt, version: version.version });
  } catch (err) { next(err); }
});

reportsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null } });
    if (!report) throw new AppError(404, 'not_found', 'Report not found.');
    await prisma.report.update({ where: { id: report.id }, data: { deletedAt: new Date() } });
    await recordAudit({ organizationId: report.organizationId, userId: req.user!.id, action: 'reports.deleted', resourceType: 'Report', resourceId: report.id, metadata: { softDelete: true } });
    res.status(204).send();
  } catch (err) { next(err); }
});
