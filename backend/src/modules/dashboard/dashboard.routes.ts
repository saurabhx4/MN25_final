import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { topZonesQuery, mnDistributionQuery } from '../../utils/validation';
import {
  getDashboardSummary,
  getTopZones,
  getManganeseDistribution,
  listRecentAnalyses,
} from './dashboard.service';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const data = await getDashboardSummary(req.user!.organizationId, req.user!.id);
    res.set('Cache-Control', 'private, max-age=15');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/top-zones', async (req, res, next) => {
  try {
    const parsed = topZonesQuery.parse(req.query);
    const data = await getTopZones({ organizationId: req.user!.organizationId, ...parsed });
    res.set('Cache-Control', 'private, max-age=30');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/manganese-distribution', async (req, res, next) => {
  try {
    const parsed = mnDistributionQuery.parse(req.query);
    const data = await getManganeseDistribution({ organizationId: req.user!.organizationId, ...parsed });
    res.set('Cache-Control', 'private, max-age=60');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/recent-analyses', async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const data = await listRecentAnalyses(req.user!.organizationId, limit);
    res.json({ results: data });
  } catch (err) {
    next(err);
  }
});
