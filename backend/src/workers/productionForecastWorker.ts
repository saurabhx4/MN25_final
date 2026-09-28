import { Worker } from 'bullmq';
import { env } from '../config/env';
import { calculateForecast, completeForecast, failForecast } from '../modules/production/production.service';
import { prisma } from '../lib/prisma';
import { recordAudit } from '../modules/audit/audit.service';

export const productionForecastWorker = new Worker('production-forecast-jobs', async job => {
  const { forecastId } = job.data as { forecastId: string };
  const row = await prisma.productionForecast.findUnique({ where: { id: forecastId } });
  if (!row) return;
  await prisma.productionForecast.update({ where: { id: forecastId }, data: { status: 'RUNNING', errorMessage: null } });
  try {
    const result = await calculateForecast(forecastId);
    await completeForecast(forecastId, result);
    await recordAudit({ organizationId: row.organizationId, userId: row.requestedByUserId, action: 'production.forecast.completed', resourceType: 'ProductionForecast', resourceId: forecastId, metadata: { modelVersion: row.modelVersionLabel, confidence: result.confidence } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Production forecast failed.';
    await failForecast(forecastId, message);
    await recordAudit({ organizationId: row.organizationId, userId: row.requestedByUserId, action: 'production.forecast.failed', resourceType: 'ProductionForecast', resourceId: forecastId, metadata: { error: message } });
    throw err;
  }
}, { connection: { url: env.redisUrl }, concurrency: 2 });

productionForecastWorker.on('failed', (job, err) => console.error('production_forecast_job_failed', job?.id, err));
