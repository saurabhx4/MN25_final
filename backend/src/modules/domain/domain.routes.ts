import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { getAnalysisProvenance, getPredictionProvenance, ensureCanonicalAnalysis, ensureCanonicalPrediction } from './domain.service';
import { prisma } from '../../lib/prisma';

export const domainRouter = Router();
domainRouter.use(requireAuth);

domainRouter.get('/analyses/:id/provenance', requirePermission('data.read'), async (req, res, next) => {
  try {
    const canonical = await ensureCanonicalAnalysis(req.params.id, req.user!.organizationId).catch(async () => {
      const row = await prisma.analysis.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
      if (!row) throw new Error('NOT_FOUND');
      return row;
    });
    res.json(await getAnalysisProvenance(canonical.id, req.user!.organizationId));
  } catch (err) { next(err); }
});

domainRouter.get('/predictions/:id/provenance', requirePermission('data.read'), async (req, res, next) => {
  try {
    await ensureCanonicalPrediction(req.params.id, req.user!.organizationId).catch(() => undefined);
    res.json(await getPredictionProvenance(req.params.id, req.user!.organizationId));
  } catch (err) { next(err); }
});

domainRouter.get('/organizations/me/graph', requirePermission('data.read'), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const [organization, mines, datasets, models, analyses, reports, actions] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, createdAt: true } }),
      prisma.mine.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, region: true } }),
      prisma.dataset.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, type: true, version: true, checksum: true, processingStatus: true } }),
      prisma.modelRegistry.findMany({ where: { OR: [{ organizationId: null }, { organizationId: orgId }] }, select: { id: true, name: true, status: true, currentVersion: true } }),
      prisma.analysisJob.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, analysisType: true, status: true, modelVersionId: true, createdAt: true } }),
      prisma.report.findMany({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, status: true, currentVersion: true } }),
      prisma.action.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, status: true, actionPlanId: true } }),
    ]);
    res.json({ organization, mines, datasets, models, analyses, reports, actions });
  } catch (err) { next(err); }
});
