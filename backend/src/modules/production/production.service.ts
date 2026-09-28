import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../audit/audit.service';
import { registerModelVersion } from '../models/model.service';

const BASELINE_MODEL = {
  name: 'MN25 Statistical Production Forecast',
  version: '1.0.0',
  description: 'Backend statistical baseline using recent observed production, trend and dispersion. It is not a trained ML model.',
};

function clamp(v: number, min = 0, max = 100) { return Math.min(max, Math.max(min, v)); }
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}
function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function dateKey(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

export async function getMineOrThrow(organizationId: string, mineId: string) {
  const mine = await prisma.mine.findFirst({ where: { id: mineId, organizationId }, select: { id: true, name: true, region: true } });
  if (!mine) throw new AppError(404, 'not_found', 'Mine not found in the current organization.');
  return mine;
}

export async function listProductionHistory(params: { organizationId: string; mineId: string; startDate?: Date; endDate?: Date; granularity?: string }) {
  await getMineOrThrow(params.organizationId, params.mineId);
  const rows = await prisma.productionRecord.findMany({
    where: {
      organizationId: params.organizationId,
      mineId: params.mineId,
      date: { gte: params.startDate, lte: params.endDate },
    },
    orderBy: { date: 'asc' },
  });
  if (!rows.length) return { status: 'unavailable' as const, reason: 'No production history is available for this mine and period.', results: [] };
  // The current frontend is daily. Aggregate weekly/monthly only when explicitly requested.
  if (params.granularity === 'daily' || !params.granularity) return { status: 'available' as const, results: rows.map(toHistory) };
  return { status: 'available' as const, results: aggregate(rows, params.granularity) };
}

function toHistory(r: any) {
  return {
    date: r.date.toISOString().slice(0, 10), plannedProduction: r.plannedProduction, actualProduction: r.actualProduction,
    oreGrade: r.oreGrade, equipmentAvailability: r.equipmentAvailability, weather: r.weather, downtime: r.downtime,
    source: r.sourceName ? { name: r.sourceName, datasetVersion: r.sourceDatasetVersion, url: r.sourceUrl } : null,
  };
}

function aggregate(rows: any[], granularity: string) {
  const buckets = new Map<string, any[]>();
  for (const r of rows) {
    const d = r.date as Date;
    const key = granularity === 'monthly'
      ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      : `${d.getUTCFullYear()}-W${isoWeek(d).toString().padStart(2, '0')}`;
    const arr = buckets.get(key) ?? []; arr.push(r); buckets.set(key, arr);
  }
  return [...buckets.entries()].map(([period, rs]) => ({
    date: period,
    plannedProduction: rs.every(r => r.plannedProduction == null) ? null : rs.reduce((s, r) => s + (r.plannedProduction ?? 0), 0),
    actualProduction: rs.every(r => r.actualProduction == null) ? null : rs.reduce((s, r) => s + (r.actualProduction ?? 0), 0),
    oreGrade: mean(rs.filter(r => r.oreGrade != null).map(r => r.oreGrade)),
    equipmentAvailability: mean(rs.filter(r => r.equipmentAvailability != null).map(r => r.equipmentAvailability)),
    weather: rs.map(r => r.weather).filter(Boolean),
    downtime: mean(rs.filter(r => r.downtime != null).map(r => r.downtime)),
    source: null,
  }));
}
function isoWeek(d: Date) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil((((x.getTime() - yearStart.getTime()) / 86400000) + 1) / 7); }

async function ensureBaselineModel(organizationId: string) {
  const { version } = await registerModelVersion({
    organizationId,
    name: BASELINE_MODEL.name,
    version: BASELINE_MODEL.version,
    type: 'PRODUCTION_FORECAST',
    description: BASELINE_MODEL.description,
    trainingDataset: 'Organization production history at inference time',
  });
  return version;
}

export async function createForecast(params: { organizationId: string; userId: string; mineId: string; forecastHorizon: number; requestedModel?: string | null }) {
  await getMineOrThrow(params.organizationId, params.mineId);
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: params.organizationId } });
  const modelLabel = params.requestedModel ?? settings?.defaultModel ?? null;
  const model = modelLabel
    ? await prisma.modelVersion.findFirst({ where: { type: 'PRODUCTION_FORECAST', OR: [{ id: modelLabel }, { version: modelLabel }, { name: modelLabel }], model: { OR: [{ organizationId: null }, { organizationId: params.organizationId }] } }, orderBy: { releasedAt: 'desc' } })
    : await ensureBaselineModel(params.organizationId);
  if (!model) throw new AppError(400, 'model_unavailable', 'Requested production forecast model is not registered.');
  if (model.status !== 'DEPLOYED') throw new AppError(409, 'model_not_deployed', 'The requested production forecast model version is not deployed. A model must have validation metrics and be explicitly deployed before it can generate production predictions.');

  const forecast = await prisma.productionForecast.create({
    data: {
      organizationId: params.organizationId, mineId: params.mineId, requestedByUserId: params.userId,
      forecastHorizon: params.forecastHorizon, modelVersionId: model.id, modelId: model.id,
      modelVersionLabel: `${model.name} v${model.version}`, trainingDataset: model.trainingDataset,
      status: 'QUEUED', inputSnapshot: { requestedModel: modelLabel, forecastHorizon: params.forecastHorizon },
    },
  });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'production.forecast.requested', resourceType: 'ProductionForecast', resourceId: forecast.id, metadata: { mineId: params.mineId, horizon: params.forecastHorizon, modelVersion: `${model.name} v${model.version}` } });
  return forecast;
}

export async function calculateForecast(forecastId: string) {
  const row = await prisma.productionForecast.findUnique({ where: { id: forecastId }, include: { mine: true, modelVersion: true } });
  if (!row) throw new Error('Forecast not found.');
  const history = await prisma.productionRecord.findMany({ where: { organizationId: row.organizationId, mineId: row.mineId, actualProduction: { not: null } }, orderBy: { date: 'desc' }, take: 180 });
  history.reverse();
  if (history.length < 7) throw new Error('Insufficient production history. At least 7 observed production records are required for forecasting.');

  const actual = history.map(r => r.actualProduction as number);
  const recent = actual.slice(-Math.min(28, actual.length));
  const window = recent.slice(-7);
  const older = recent.slice(0, Math.max(1, recent.length - window.length));
  const recentMean = mean(window);
  const olderMean = mean(older);
  const trend = older.length ? clamp((recentMean - olderMean) / Math.max(1, olderMean), -0.2, 0.2) : 0;
  const alpha = 0.35;
  let level = actual[0];
  for (const v of actual) level = alpha * v + (1 - alpha) * level;
  const dailyTarget = mean(history.filter(r => r.plannedProduction != null).slice(-28).map(r => r.plannedProduction as number));
  const targetAvailable = history.some(r => r.plannedProduction != null);
  const baseline = 0.65 * recentMean + 0.35 * level;
  const residuals = actual.slice(1).map((v, i) => v - actual[i]);
  const uncertainty = percentile(residuals.map(Math.abs), 0.8);
  const forecastPoints = Array.from({ length: row.forecastHorizon }, (_, i) => {
    const value = Math.max(0, baseline * (1 + trend * ((i + 1) / row.forecastHorizon)));
    return { date: dateKey(addDays(new Date(history[history.length - 1].date), i + 1)), predictedProduction: Math.round(value), lowerBound: Math.max(0, Math.round(value - uncertainty)), upperBound: Math.round(value + uncertainty) };
  });
  const production = forecastPoints.reduce((s, p) => s + p.predictedProduction, 0);
  const target = targetAvailable ? dailyTarget * row.forecastHorizon : null;
  const shortfall = target == null ? null : Math.max(0, target - production);
  const cv = std(recent) / Math.max(1, recentMean);
  const confidence = clamp(95 - cv * 100 - Math.max(0, 14 - history.length) * 2);
  const factors = [
    { name: 'Historical production', value: recentMean, impact: Math.round((1 - Math.min(1, cv)) * 100), source: 'production-history', observedAt: history[history.length - 1].date.toISOString() },
    ...(history.some(r => r.equipmentAvailability != null) ? [{ name: 'Equipment availability', value: mean(history.slice(-28).filter(r => r.equipmentAvailability != null).map(r => r.equipmentAvailability as number)), impact: null, source: 'production-history' }] : []),
    ...(history.some(r => r.oreGrade != null) ? [{ name: 'Ore characteristics', value: mean(history.slice(-28).filter(r => r.oreGrade != null).map(r => r.oreGrade as number)), impact: null, source: 'production-history' }] : []),
    ...(history.some(r => r.downtime != null) ? [{ name: 'Equipment downtime', value: mean(history.slice(-28).filter(r => r.downtime != null).map(r => r.downtime as number)), impact: null, source: 'production-history' }] : []),
  ];
  return { forecastPoints, production, target, shortfall, confidence: Math.round(confidence), uncertainty: Math.round(uncertainty), factors, trainingDataset: row.modelVersion?.trainingDataset ?? `organization:${row.organizationId}:production-history` };
}

export async function completeForecast(forecastId: string, result: any) {
  return prisma.productionForecast.update({ where: { id: forecastId }, data: { status: 'COMPLETED', forecast: result.forecastPoints, target: result.target, shortfall: result.shortfall, confidence: result.confidence, uncertainty: result.uncertainty, factors: result.factors, trainingDataset: result.trainingDataset, generatedAt: new Date(), errorMessage: null } });
}

export async function failForecast(forecastId: string, message: string) {
  return prisma.productionForecast.update({ where: { id: forecastId }, data: { status: 'FAILED', errorMessage: message } });
}

export async function getForecast(organizationId: string, id: string) {
  const row = await prisma.productionForecast.findFirst({ where: { id, organizationId }, include: { modelVersion: true, mine: true } });
  if (!row) throw new AppError(404, 'not_found', 'Forecast not found.');
  return {
    forecastId: row.id, status: row.status, mine: { id: row.mine.id, name: row.mine.name, region: row.mine.region },
    forecast: row.forecast, target: row.target, shortfall: row.shortfall, confidence: row.confidence, uncertainty: row.uncertainty,
    modelId: row.modelId, modelVersion: row.modelVersionLabel, trainingDataset: row.trainingDataset, forecastGeneratedAt: row.generatedAt,
    factors: row.factors, errorMessage: row.errorMessage,
  };
}

export async function runScenario(params: { organizationId: string; userId: string; mineId: string; equipmentDowntime: number; blastingDelay: number; workingHours: number; rainfall: string; forecastHorizon: number }) {
  await getMineOrThrow(params.organizationId, params.mineId);
  const history = await prisma.productionRecord.findMany({ where: { organizationId: params.organizationId, mineId: params.mineId, actualProduction: { not: null } }, orderBy: { date: 'desc' }, take: 28 });
  if (history.length < 7) throw new AppError(409, 'data_unavailable', 'At least 7 observed production records are required to run a scenario.');
  const actual = history.map(r => r.actualProduction as number);
  const baseDaily = mean(actual);
  const planned = history.filter(r => r.plannedProduction != null).map(r => r.plannedProduction as number);
  const targetDaily = planned.length ? mean(planned) : null;
  const histAvail = history.filter(r => r.equipmentAvailability != null).map(r => r.equipmentAvailability as number);
  const histDowntime = history.filter(r => r.downtime != null).map(r => r.downtime as number);
  const baselineAvail = histAvail.length ? mean(histAvail) : 100 - (histDowntime.length ? mean(histDowntime) : 0);
  const rainPenalty = params.rainfall === 'High' ? 0.12 : params.rainfall === 'Medium' ? 0.06 : 0.02;
  const equipmentEffect = clamp((100 - params.equipmentDowntime) / Math.max(1, baselineAvail), 0, 1.25);
  const blastEffect = 1 - clamp(params.blastingDelay / 100) * 0.12;
  const hoursEffect = 0.75 + 0.25 * clamp(params.workingHours / 100);
  const daily = Math.max(0, baseDaily * equipmentEffect * blastEffect * hoursEffect * (1 - rainPenalty));
  const production = Math.round(daily * params.forecastHorizon);
  const target = targetDaily == null ? null : targetDaily * params.forecastHorizon;
  const shortfall = target == null ? null : Math.max(0, target - production);
  const recoveryOpportunity = target == null ? null : Math.max(0, Math.round((daily * (1 + Math.min(0.15, params.equipmentDowntime / 100 * 0.15)) - daily) * params.forecastHorizon));
  const risk = Math.round(clamp(25 + params.equipmentDowntime * 0.45 + params.blastingDelay * 0.25 + (params.rainfall === 'High' ? 28 : params.rainfall === 'Medium' ? 14 : 4) - params.workingHours * 0.12));
  const confidence = Math.round(clamp(92 - (std(actual) / Math.max(1, baseDaily)) * 100 - Math.max(0, 14 - history.length) * 2));
  const modelVersion = 'MN25 Production Scenario Baseline v1.0.0';
  const trainingDataset = `organization:${params.organizationId}:mine:${params.mineId}:production-history`;
  const saved = await prisma.productionScenario.create({ data: {
    organizationId: params.organizationId, mineId: params.mineId, requestedByUserId: params.userId,
    forecastHorizon: params.forecastHorizon, equipmentDowntime: params.equipmentDowntime, blastingDelay: params.blastingDelay,
    workingHours: params.workingHours, rainfall: params.rainfall, modelId: 'mn25-production-scenario-baseline', modelVersion,
    trainingDataset, production, shortfall, recoveryOpportunity, risk, confidence,
    assumptions: { baselineDaily: baseDaily, baselineAvailability: baselineAvail, rainfallPenalty: rainPenalty, targetDaily, note: 'Backend statistical sensitivity model using observed production history; not a trained ML model.' },
  } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'production.scenario.created', resourceType: 'ProductionScenario', resourceId: saved.id, metadata: { mineId: params.mineId, forecastHorizon: params.forecastHorizon, modelVersion } });
  return { scenarioId: saved.id, production, shortfall, recoveryOpportunity, risk, confidence, modelId: saved.modelId, modelVersion: saved.modelVersion, trainingDataset: saved.trainingDataset, assumptions: saved.assumptions };
}
