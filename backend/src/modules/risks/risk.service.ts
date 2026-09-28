import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../audit/audit.service';

const CALCULATION_VERSION = 'MN25 Operational Risk Engine v1.0.0';

type Signal = { name: string; probability: number; impact: number; cause: string; mitigation: string; evidence: any; source: any };

function clamp(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }
function severity(score: number): 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL' {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export async function getMine(organizationId: string, mineId: string) {
  const mine = await prisma.mine.findFirst({ where: { id: mineId, organizationId }, select: { id: true, name: true, region: true } });
  if (!mine) throw new AppError(404, 'not_found', 'Mine not found in the current organization.');
  return mine;
}

function mapRisk(r: any) {
  return {
    id: r.id, name: r.name, cause: r.cause, impact: r.impact, probability: r.probability,
    riskScore: r.riskScore, severity: r.severity, status: r.status, affectedArea: r.affectedArea,
    evidence: r.evidence, source: r.source, mitigation: r.mitigation, notes: r.notes,
    owner: r.owner ? { id: r.owner.id, name: r.owner.name, email: r.owner.email } : null,
    calculationVersion: r.calculationVersion, modelVersion: r.modelVersion ? `${r.modelVersion.name} v${r.modelVersion.version}` : null,
    confidence: r.confidence, uncertainty: r.uncertainty, inputFactors: r.inputFactors,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listRisks(params: { organizationId: string; mineId?: string; severity?: string; status?: string; date?: Date }) {
  const rows = await prisma.risk.findMany({
    where: {
      organizationId: params.organizationId,
      mineId: params.mineId,
      severity: params.severity as any,
      status: params.status as any,
      ...(params.date ? { createdAt: { gte: params.date, lt: new Date(params.date.getTime() + 86400000) } } : {}),
    }, orderBy: [{ riskScore: 'desc' }, { updatedAt: 'desc' }], include: { owner: true, modelVersion: true },
  });
  return { status: rows.length ? 'available' : 'unavailable', results: rows.map(mapRisk), reason: rows.length ? undefined : 'No calculated risks are available for the selected filters.' };
}

export async function getRisk(organizationId: string, id: string) {
  const r = await prisma.risk.findFirst({ where: { id, organizationId }, include: { owner: true, modelVersion: true } });
  return r ? mapRisk(r) : null;
}

export async function matrix(organizationId: string, mineId?: string) {
  const rows = await prisma.risk.findMany({ where: { organizationId, mineId, status: { not: 'RESOLVED' } }, select: { id: true, name: true, probability: true, impact: true, riskScore: true, severity: true, status: true, affectedArea: true } });
  return { results: rows };
}

async function buildSignals(organizationId: string, mineId: string): Promise<Signal[]> {
  const history = await prisma.productionRecord.findMany({ where: { organizationId, mineId }, orderBy: { date: 'desc' }, take: 30 });
  if (!history.length) return [];
  const signals: Signal[] = [];
  const actual = history.filter(r => r.actualProduction != null).map(r => r.actualProduction as number);
  const planned = history.filter(r => r.plannedProduction != null && r.actualProduction != null);
  if (planned.length) {
    const deviations = planned.map(r => ((r.actualProduction as number) - (r.plannedProduction as number)) / Math.max(1, r.plannedProduction as number) * 100);
    const avgDev = deviations.reduce((a,b)=>a+b,0)/deviations.length;
    if (avgDev < -5) {
      const probability = clamp(50 + Math.abs(avgDev) * 2);
      const impact = clamp(45 + Math.abs(avgDev) * 2);
      signals.push({ name: 'Production Deviation', probability, impact, cause: `Observed production is ${Math.abs(avgDev).toFixed(1)}% below plan on average in the available records.`, mitigation: 'Review the current production constraint and update the operating plan.', evidence: { averageDeviationPercent: Number(avgDev.toFixed(2)), records: planned.length }, source: { type: 'production_history', datasetVersions: [...new Set(planned.map(r => r.sourceDatasetVersion).filter(Boolean))] } });
    }
  }
  const availability = history.filter(r => r.equipmentAvailability != null).map(r => r.equipmentAvailability as number);
  if (availability.length) {
    const avg = availability.reduce((a,b)=>a+b,0)/availability.length;
    if (avg < 85) {
      const probability = clamp(100 - avg);
      const impact = clamp(40 + (85 - avg) * 2);
      signals.push({ name: 'Equipment Availability', probability, impact, cause: `Recorded equipment availability averages ${avg.toFixed(1)}% in the available records.`, mitigation: 'Review maintenance availability and equipment allocation.', evidence: { averageAvailabilityPercent: Number(avg.toFixed(2)), records: availability.length }, source: { type: 'production_history', datasetVersions: [...new Set(history.map(r => r.sourceDatasetVersion).filter(Boolean))] } });
    }
  }
  const downtime = history.filter(r => r.downtime != null).map(r => r.downtime as number);
  if (downtime.length) {
    const avg = downtime.reduce((a,b)=>a+b,0)/downtime.length;
    if (avg > 10) {
      const probability = clamp(avg * 2);
      const impact = clamp(45 + avg);
      signals.push({ name: 'Equipment Downtime', probability, impact, cause: `Recorded downtime averages ${avg.toFixed(1)}% in the available records.`, mitigation: 'Review recurring downtime and maintenance windows.', evidence: { averageDowntimePercent: Number(avg.toFixed(2)), records: downtime.length }, source: { type: 'production_history', datasetVersions: [...new Set(history.map(r => r.sourceDatasetVersion).filter(Boolean))] } });
    }
  }
  const weather = history.filter(r => r.weather && typeof r.weather === 'object') as any[];
  const rainValues = weather.map(r => String((r.weather as any)?.rainfall ?? '')).filter(Boolean);
  const highRain = rainValues.filter(v => v.toLowerCase() === 'high').length;
  if (highRain > 0) {
    const probability = clamp((highRain / rainValues.length) * 100);
    const impact = 60;
    signals.push({ name: 'Weather / Rainfall', probability, impact, cause: `High rainfall is present in ${highRain} of ${rainValues.length} weather records.`, mitigation: 'Review weather-sensitive operations and haulage/blasting windows.', evidence: { highRainRecords: highRain, weatherRecords: rainValues.length }, source: { type: 'production_weather', datasetVersions: [...new Set(history.map(r => r.sourceDatasetVersion).filter(Boolean))] } });
  }
  // No blasting/geospatial risk is generated unless an actual source provides those inputs.
  return signals;
}

export async function evaluateRisks(params: { organizationId: string; userId: string; mineId: string }) {
  await getMine(params.organizationId, params.mineId);
  const signals = await buildSignals(params.organizationId, params.mineId);
  if (!signals.length) return { status: 'unavailable', reason: 'Insufficient operational data to calculate risk. No qualifying production, equipment, downtime, or weather signals were found.', results: [] };
  const results = [];
  for (const s of signals) {
    const riskScore = clamp((s.probability * s.impact) / 100);
    const existing = await prisma.risk.findFirst({ where: { organizationId: params.organizationId, mineId: params.mineId, name: s.name, status: { not: 'RESOLVED' } }, orderBy: { updatedAt: 'desc' } });
    const data = { cause: s.cause, impact: s.impact, probability: s.probability, riskScore, severity: severity(riskScore), evidence: s.evidence, source: s.source, mitigation: s.mitigation, calculationVersion: CALCULATION_VERSION, inputFactors: s.evidence };
    const row = existing ? await prisma.risk.update({ where: { id: existing.id }, data }) : await prisma.risk.create({ data: { organizationId: params.organizationId, mineId: params.mineId, name: s.name, ...data } });
    results.push(mapRisk(await prisma.risk.findUnique({ where: { id: row.id }, include: { owner: true, modelVersion: true } })));
  }
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: 'risk.evaluation.completed', resourceType: 'Risk', metadata: { mineId: params.mineId, calculationVersion: CALCULATION_VERSION, count: results.length } });
  return { status: 'available', results };
}

export async function updateRisk(params: { organizationId: string; userId: string; id: string; changes: { status?: any; mitigation?: string; ownerId?: string | null; notes?: string } }) {
  const existing = await prisma.risk.findFirst({ where: { id: params.id, organizationId: params.organizationId } });
  if (!existing) return null;
  if (params.changes.ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: params.changes.ownerId, organizationId: params.organizationId }, select: { id: true } });
    if (!owner) throw new AppError(400, 'invalid_owner', 'Risk owner is not part of the current organization.');
  }
  const updated = await prisma.risk.update({ where: { id: existing.id }, data: params.changes, include: { owner: true, modelVersion: true } });
  const eventType = params.changes.status === 'ACKNOWLEDGED' ? 'acknowledged' : params.changes.status === 'RESOLVED' ? 'resolved' : 'updated';
  await prisma.riskEvent.create({ data: { organizationId: params.organizationId, riskId: existing.id, actorId: params.userId, eventType, metadata: { changes: params.changes } } });
  await recordAudit({ organizationId: params.organizationId, userId: params.userId, action: `risk.${eventType}`, resourceType: 'Risk', resourceId: existing.id, metadata: { oldValue: existing, newValue: updated } });
  return mapRisk(updated);
}

export async function acknowledgeRisk(organizationId: string, userId: string, id: string) {
  return updateRisk({ organizationId, userId, id, changes: { status: 'ACKNOWLEDGED' } });
}
export async function resolveRisk(organizationId: string, userId: string, id: string) {
  return updateRisk({ organizationId, userId, id, changes: { status: 'RESOLVED' } });
}
