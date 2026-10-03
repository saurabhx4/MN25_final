import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';

export const systemRouter = Router();
systemRouter.use(requireAuth);

const requestedComponents = [
  ['database', 'database'],
  ['aiEngine', 'ai_engine'],
  ['geospatialEngine', 'geospatial_engine'],
  ['satellitePipeline', 'satellite_pipeline'],
  ['forecasting', 'forecasting_engine'],
  ['reportGeneration', 'report_service'],
  ['storage', 'storage'],
] as const;

function publicStatus(status: string) {
  if (status === 'OPERATIONAL') return 'operational';
  if (status === 'DEGRADED') return 'degraded';
  if (status === 'DOWN') return 'offline';
  return 'degraded'; // UNKNOWN is not reported as operational; it means health is not established.
}

systemRouter.get('/status', async (_req, res, next) => {
  try {
    const rows = await prisma.systemComponentStatus.findMany();
    const byComponent = new Map<string, any>(rows.map((r: any) => [r.component, r]));
    const components = Object.fromEntries(requestedComponents.map(([key, dbKey]) => {
      const r = byComponent.get(dbKey);
      return [key, r ? { status: publicStatus(r.status), latency: r.latencyMs, lastChecked: r.lastCheckedAt, version: r.version ?? null, message: r.message ?? null } : { status: 'degraded', latency: null, lastChecked: null, version: null, message: 'No health probe has reported yet.' }];
    }));
    res.json({ components });
  } catch (err) { next(err); }
});
