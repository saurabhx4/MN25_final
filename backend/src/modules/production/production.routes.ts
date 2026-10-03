import { Router } from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { createForecast, getForecast, getMineOrThrow, listProductionHistory, runScenario } from './production.service';

export const productionRouter = Router();
productionRouter.use(requireAuth);
const forecastQueue = new Queue('production-forecast-jobs', { connection: { url: env.redisUrl } });

const historyQuery = z.object({ mineId: z.string().uuid(), startDate: z.string().date().optional(), endDate: z.string().date().optional(), granularity: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily') });
const forecastBody = z.object({ mineId: z.string().uuid(), forecastHorizon: z.coerce.number().int().refine(v => [7, 30, 90].includes(v), 'forecastHorizon must be 7, 30 or 90.'), modelVersion: z.string().max(160).optional().nullable() });
const scenarioBody = z.object({ mineId: z.string().uuid(), equipmentDowntime: z.coerce.number().min(0).max(100), blastingDelay: z.coerce.number().min(0).max(100), workingHours: z.coerce.number().min(0).max(100), rainfall: z.enum(['Low', 'Medium', 'High']), forecastHorizon: z.coerce.number().int().refine(v => [7, 30, 90].includes(v), 'forecastHorizon must be 7, 30 or 90.') });


const ingestBody = z.object({
  records: z.array(z.object({
    date: z.string().date(), plannedProduction: z.number().nonnegative().nullable().optional(), actualProduction: z.number().nonnegative().nullable().optional(),
    oreGrade: z.number().min(0).max(100).nullable().optional(), equipmentAvailability: z.number().min(0).max(100).nullable().optional(),
    weather: z.unknown().nullable().optional(), downtime: z.number().min(0).max(100).nullable().optional(),
    sourceName: z.string().min(1).max(200), sourceDatasetVersion: z.string().min(1).max(120), sourceUrl: z.string().url().nullable().optional(),
  }).refine(v => v.plannedProduction != null || v.actualProduction != null, { message: 'Each record must contain plannedProduction or actualProduction.' })).min(1).max(5000),
});

productionRouter.post('/history', async (req, res, next) => {
  try {
    if (!['ADMIN', 'MANAGER'].includes(req.user!.role)) return res.status(403).json({ error: 'forbidden', message: 'Only organization managers/admins can ingest production records.' });
    const body = ingestBody.parse(req.body);
    const mineId = z.string().uuid().parse(req.query.mineId);
    await getMineOrThrow(req.user!.organizationId, mineId);
    const rows = await prisma.$transaction(body.records.map(r => prisma.productionRecord.upsert({
      where: { mineId_date: { mineId, date: new Date(`${r.date}T00:00:00.000Z`) } },
      update: { plannedProduction: r.plannedProduction ?? null, actualProduction: r.actualProduction ?? null, oreGrade: r.oreGrade ?? null, equipmentAvailability: r.equipmentAvailability ?? null, weather: r.weather as any, downtime: r.downtime ?? null, sourceName: r.sourceName, sourceDatasetVersion: r.sourceDatasetVersion, sourceUrl: r.sourceUrl ?? null },
      create: { organizationId: req.user!.organizationId, mineId, date: new Date(`${r.date}T00:00:00.000Z`), plannedProduction: r.plannedProduction ?? null, actualProduction: r.actualProduction ?? null, oreGrade: r.oreGrade ?? null, equipmentAvailability: r.equipmentAvailability ?? null, weather: r.weather as any, downtime: r.downtime ?? null, sourceName: r.sourceName, sourceDatasetVersion: r.sourceDatasetVersion, sourceUrl: r.sourceUrl ?? null },
    })));
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'production.history.ingested', resourceType: 'ProductionRecord', metadata: { mineId, count: rows.length } });
    res.status(201).json({ count: rows.length });
  } catch (err) { next(err); }
});

productionRouter.get('/history', async (req, res, next) => {
  try {
    const q = historyQuery.parse(req.query);
    const end = q.endDate ? new Date(`${q.endDate}T23:59:59.999Z`) : new Date();
    const start = q.startDate ? new Date(`${q.startDate}T00:00:00.000Z`) : new Date(end.getTime() - 89 * 86400000);
    res.json(await listProductionHistory({ organizationId: req.user!.organizationId, mineId: q.mineId, startDate: start, endDate: end, granularity: q.granularity }));
  } catch (err) { next(err); }
});

productionRouter.post('/forecast', async (req, res, next) => {
  try {
    const body = forecastBody.parse(req.body);
    const row = await createForecast({ organizationId: req.user!.organizationId, userId: req.user!.id, mineId: body.mineId, forecastHorizon: body.forecastHorizon, requestedModel: body.modelVersion });
    await forecastQueue.add('generate-production-forecast', { forecastId: row.id }, { removeOnComplete: 100, removeOnFail: 100 });
    res.status(202).json({ forecastId: row.id, status: row.status });
  } catch (err) { next(err); }
});

productionRouter.get('/forecast/:id', async (req, res, next) => {
  try { res.json(await getForecast(req.user!.organizationId, req.params.id)); } catch (err) { next(err); }
});

productionRouter.post('/scenario', async (req, res, next) => {
  try { const body = scenarioBody.parse(req.body); res.json(await runScenario({ organizationId: req.user!.organizationId, userId: req.user!.id, ...(body as Omit<Parameters<typeof runScenario>[0], 'organizationId' | 'userId'>) })); } catch (err) { next(err); }
});

productionRouter.post('/forecast/:id/report', async (req, res, next) => {
  try {
    const forecast = await prisma.productionForecast.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!forecast) return res.status(404).json({ error: 'not_found', message: 'Forecast not found.' });
    if (forecast.status !== 'COMPLETED') return res.status(409).json({ error: 'not_ready', message: `Forecast is ${forecast.status.toLowerCase()}.` });
    const title = `Production Forecast Report — ${forecast.mineId}`;
    const report = await prisma.report.create({ data: {
      organizationId: forecast.organizationId, requestedByUserId: req.user!.id, title,
      subjectType: 'production_forecast', subjectId: forecast.id, reportType: 'detailed',
      sections: ['summary', 'production', 'model', 'sources', 'limits'], analysisIds: [], status: 'QUEUED',
    } });
    const { reportQueue } = await import('../reports/reports.routes');
    await reportQueue.add('generate-report', { reportId: report.id, reason: 'production-forecast-report' }, { removeOnComplete: 100, removeOnFail: 100 });
    await recordAudit({ organizationId: report.organizationId, userId: req.user!.id, action: 'production.forecast.report_requested', resourceType: 'ProductionForecast', resourceId: forecast.id, metadata: { reportId: report.id } });
    res.status(202).json({ reportId: report.id, status: report.status });
  } catch (err) { next(err); }
});
