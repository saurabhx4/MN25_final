import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { ensureCanonicalAnalysis, getAnalysisProvenance } from '../domain/domain.service';

const sectionLabels: Record<string, string> = {
  summary: 'Executive Summary', maps: 'Location & Maps', mining: 'Mining Information', geology: 'Geological Profile', production: 'Production Forecast',
  ai: 'AI Prospectivity', spectral: 'Spectral Analysis', model: 'Model Insights', sources: 'Data Sources', limits: 'Limitations',
};

function unavailable(reason: string) { return { status: 'unavailable', reason, dataSource: null }; }

export async function buildReportSnapshot(reportId: string, userId: string) {
  const report = await prisma.report.findFirst({
    where: { id: reportId, requestedByUserId: userId, deletedAt: null },
  });
  if (!report) throw new AppError(404, 'not_found', 'Report not found.');

  if (report.subjectType === 'production_forecast') {
    const forecast = await prisma.productionForecast.findFirst({
      where: { id: report.subjectId, organizationId: report.organizationId },
      include: { mine: true, modelVersion: true },
    });
    if (!forecast) throw new AppError(404, 'not_found', 'Production forecast not found for this report.');
    const analysisSnapshot = {
      subject: { id: forecast.mine.id, name: forecast.mine.name, region: forecast.mine.region },
      analysisIds: [],
      forecastId: forecast.id,
      generatedAt: new Date().toISOString(),
    };
    const modelSnapshot = forecast.modelVersion ? {
      id: forecast.modelVersion.id, name: forecast.modelVersion.name, version: forecast.modelVersion.version,
      type: forecast.modelVersion.type, description: forecast.modelVersion.description,
      trainingDataset: forecast.trainingDataset ?? forecast.modelVersion.trainingDataset, metrics: forecast.modelVersion.metrics,
      prediction: { target: forecast.target, shortfall: forecast.shortfall, confidence: forecast.confidence, uncertainty: forecast.uncertainty, factors: forecast.factors },
    } : unavailable('No model metadata is available for this forecast.');
    const dataSnapshot = {
      production: { forecast: forecast.forecast, target: forecast.target, shortfall: forecast.shortfall, confidence: forecast.confidence, uncertainty: forecast.uncertainty },
      provenance: unavailable('Canonical analysis provenance is not applicable to this production forecast report.'),
    sources: [{ name: forecast.trainingDataset ?? 'Organization production history', url: null, datasetVersion: null, usedFor: ['production forecasting'] }],
    };
    const selected = new Set(report.sections);
    const sections: any[] = [];
    if (selected.has('summary')) sections.push({ id: 'summary', title: sectionLabels.summary, paragraphs: [`Production forecast for ${forecast.mine.name} over ${forecast.forecastHorizon} days. Forecast values are model-derived and are not guaranteed production outcomes.`], rows: [['Status', forecast.status], ['Forecast horizon', `${forecast.forecastHorizon} days`], ['Confidence', forecast.confidence != null ? `${forecast.confidence}%` : 'Unavailable']] });
    if (selected.has('production')) sections.push({ id: 'production', title: sectionLabels.production, rows: [['Forecast production', forecast.forecast ? `${(forecast.forecast as any[]).reduce((a, p) => a + Number(p.predictedProduction || 0), 0).toLocaleString()} tonnes` : 'Unavailable'], ['Target', forecast.target != null ? `${forecast.target.toLocaleString()} tonnes` : 'Unavailable'], ['Shortfall', forecast.shortfall != null ? `${forecast.shortfall.toLocaleString()} tonnes` : 'Unavailable'], ['Uncertainty', forecast.uncertainty != null ? `± ${forecast.uncertainty} tonnes/day` : 'Unavailable']] });
    if (selected.has('model')) sections.push({ id: 'model', title: sectionLabels.model, rows: [['Model', forecast.modelVersion ? `${forecast.modelVersion.name} v${forecast.modelVersion.version}` : 'Unavailable'], ['Training dataset', forecast.trainingDataset ?? 'Unavailable']] });
    if (selected.has('sources')) sections.push({ id: 'sources', title: sectionLabels.sources, rows: [['Production data', forecast.trainingDataset ?? 'Organization production history']] });
    if (selected.has('limits')) sections.push({ id: 'limits', title: sectionLabels.limits, bullets: ['Forecast is based on the available observed production history.', 'A forecast is not a guarantee of future production.', 'Confidence and uncertainty are model outputs and should not be interpreted as reserve or production guarantees.'] });
    const content = { title: report.title, reportType: report.reportType, subjectType: report.subjectType, subjectId: report.subjectId, generatedAt: new Date().toISOString(), sections };
    return { report, analysisSnapshot, modelSnapshot, dataSnapshot, content };
  }

  const subjectAnalysis = report.subjectType === 'analysis'
    ? await prisma.analysisJob.findFirst({ where: { id: report.subjectId, organizationId: report.organizationId }, select: { id: true, zoneId: true } })
    : null;
  const zoneInclude = { mine: true, mnObservations: { orderBy: { measuredAt: 'desc' as const }, take: 20, include: { dataSource: true } } };
  const zone = report.subjectType === 'region' || report.subjectType === 'mine' || report.subjectType === 'hotspot'
    ? await prisma.zone.findFirst({ where: { id: report.subjectId, mine: { organizationId: report.organizationId } }, include: zoneInclude })
    : subjectAnalysis?.zoneId
      ? await prisma.zone.findFirst({ where: { id: subjectAnalysis.zoneId, mine: { organizationId: report.organizationId } }, include: zoneInclude })
      : await prisma.zone.findFirst({ where: { id: report.subjectId, mine: { organizationId: report.organizationId } }, include: zoneInclude });
  const hotspot = report.subjectType === 'hotspot'
    ? await prisma.prospectivityZone.findFirst({ where: { id: report.subjectId, OR: [{ organizationId: report.organizationId }, { organizationId: null }] }, include: { modelVersion: true } })
    : null;
  if ((report.subjectType === 'region' || report.subjectType === 'mine' || report.subjectType === 'hotspot') && !zone && !hotspot) throw new AppError(404, 'not_found', 'Selected report subject was not found for this organization.');
  if (report.subjectType === 'hotspot' && !hotspot) throw new AppError(404, 'not_found', 'Selected hotspot was not found.');

  const subjectAnalysisId = report.subjectType === 'analysis' ? report.subjectId : null;
  const analysisIds = report.analysisIds.length ? report.analysisIds : (subjectAnalysisId ? [subjectAnalysisId] : []);
  const analyses = await prisma.analysisJob.findMany({
    where: { id: { in: analysisIds }, organizationId: report.organizationId },
    include: { resultPrediction: { include: { modelVersion: true } }, resultZone: { include: { modelVersion: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const latestZoneAnalysis = zone ? await prisma.analysisJob.findFirst({
    where: { organizationId: report.organizationId, zoneId: zone.id, status: 'COMPLETED' },
    include: { resultPrediction: { include: { modelVersion: true } }, resultZone: { include: { modelVersion: true } } },
    orderBy: { completedAt: 'desc' },
  }) : null;
  const allAnalyses = latestZoneAnalysis && !analyses.some(a => a.id === latestZoneAnalysis.id) ? [latestZoneAnalysis, ...analyses] : analyses;
  const selectedAnalysis = allAnalyses[0] ?? null;
  const canonicalProvenance = selectedAnalysis
    ? await ensureCanonicalAnalysis(selectedAnalysis.id, report.organizationId).then(a => getAnalysisProvenance(a.id, report.organizationId)).catch(() => null)
    : null;

  const spectral = await prisma.spectralAnalysis.findFirst({ where: { organizationId: report.organizationId, requestedByUserId: userId }, include: { dataSource: true, modelVersion: true }, orderBy: { createdAt: 'desc' } });
  const model = selectedAnalysis?.resultZone?.modelVersion ?? selectedAnalysis?.resultPrediction?.modelVersion ?? hotspot?.modelVersion ?? null;
  const prediction = selectedAnalysis?.resultZone ?? selectedAnalysis?.resultPrediction ?? hotspot ?? null;

  const analysisSnapshot = {
    subject: zone ? { id: zone.id, name: zone.name, region: zone.region, state: zone.state, district: zone.district, latitude: zone.latitude, longitude: zone.longitude, areaKm2: zone.areaKm2, status: zone.status, recordType: zone.recordType } : hotspot ? { id: hotspot.id, region: hotspot.region, latitude: hotspot.centerLatitude, longitude: hotspot.centerLongitude } : { id: report.subjectId, type: report.subjectType },
    analysisIds: allAnalyses.map(a => a.id),
    latestAnalysis: selectedAnalysis ? { id: selectedAnalysis.id, type: selectedAnalysis.analysisType, status: selectedAnalysis.status, createdAt: selectedAnalysis.createdAt.toISOString(), completedAt: selectedAnalysis.completedAt?.toISOString() ?? null, resultPayload: selectedAnalysis.resultPayload, resultZoneId: selectedAnalysis.resultZoneId, resultPredictionId: selectedAnalysis.resultPredictionId } : unavailable('No completed analysis is linked to this report subject.'),
    generatedAt: new Date().toISOString(),
  };

  const modelSnapshot = model ? {
    id: model.id, name: model.name, version: model.version, type: model.type,
    description: model.description, trainingDataset: model.trainingDataset, metrics: model.metrics, releasedAt: model.releasedAt.toISOString(),
    prediction: prediction ? {
      prospectivityScore: 'prospectivityScore' in prediction ? prediction.prospectivityScore : null,
      confidence: 'confidence' in prediction ? prediction.confidence : null,
      uncertainty: 'uncertainty' in prediction ? prediction.uncertainty : null,
      featureContributions: 'featureContributions' in prediction ? prediction.featureContributions : null,
      inputDatasetVersion: 'inputDatasetVersion' in prediction ? prediction.inputDatasetVersion : null,
    } : null,
  } : unavailable('No model output is available for the selected analysis.');

  const dataSnapshot = {
    mining: zone ? {
      mine: zone.mine ? { id: zone.mine.id, name: zone.mine.name, region: zone.mine.region } : null,
      source: zone.sourceName ? { name: zone.sourceName, url: zone.sourceUrl, verifiedAt: zone.lastVerifiedAt?.toISOString() ?? null } : null,
      oreGrade: zone.oreGradePercent != null ? { value: zone.oreGradePercent, unit: 'percent', source: zone.sourceName } : unavailable('No authoritative ore-grade figure on file.'),
      production: zone.productionTonnesPerYear != null ? { value: zone.productionTonnesPerYear, unit: 'tonnes/year', source: zone.sourceName } : unavailable('No authoritative production figure on file.'),
      historicalObservations: zone.mnObservations.length ? zone.mnObservations.map(o => ({ kind: o.kind, concentration: o.concentration, measuredAt: o.measuredAt.toISOString(), source: o.dataSource?.name ?? null, datasetVersion: o.dataSource?.datasetVersion ?? null })) : unavailable('No historical manganese observations on file.'),
      geology: zone.geology ?? unavailable('No geology attributes recorded for this zone.'),
    } : unavailable('Mining-area data is not applicable to this report subject.'),
    spectral: spectral?.status === 'COMPLETED' ? { id: spectral.id, sceneId: spectral.sceneId, bandStatistics: spectral.bandStatistics, indices: spectral.indices, anomalyMap: spectral.anomalyMap, spectralSignatures: spectral.spectralSignatures, qualityMetrics: spectral.qualityMetrics, source: spectral.dataSource ? { name: spectral.dataSource.name, datasetVersion: spectral.dataSource.datasetVersion, provenanceUrl: spectral.dataSource.provenanceUrl } : null } : unavailable(spectral?.unavailableReason ?? 'No completed spectral analysis is available.'),
    sources: [
      ...(zone?.sourceName ? [{ name: zone.sourceName, url: zone.sourceUrl, datasetVersion: null, usedFor: ['documented mining/occurrence record'] }] : []),
      ...(spectral?.dataSource ? [{ name: spectral.dataSource.name, url: spectral.dataSource.provenanceUrl, datasetVersion: spectral.dataSource.datasetVersion, usedFor: ['spectral analysis'] }] : []),
      ...(model?.trainingDataset ? [{ name: model.trainingDataset, url: null, datasetVersion: null, usedFor: ['model training provenance'] }] : []),
    ],
  };

  const content = buildContent(report, analysisSnapshot, modelSnapshot, dataSnapshot);
  return { report, analysisSnapshot, modelSnapshot, dataSnapshot, content };
}

function buildContent(report: any, analysis: any, model: any, data: any) {
  const subject = analysis.subject;
  const pred = model.prediction;
  const sections: any[] = [];
  const selected = new Set(report.sections);
  if (selected.has('summary')) sections.push({ id: 'summary', title: sectionLabels.summary, paragraphs: [pred && pred.prospectivityScore != null ? `MN25 reports a model-derived manganese prospectivity score of ${pred.prospectivityScore}/100 for ${subject.name ?? subject.region ?? subject.id}. This is an analytical prediction and does not confirm mineralization, reserve or economic recoverability.` : 'No completed model prediction is available for this subject.'], rows: [['Analysis date', new Date().toISOString()], ['Analysis IDs', analysis.analysisIds.length ? analysis.analysisIds.join(', ') : 'Unavailable']] });
  if (selected.has('maps')) sections.push({ id: 'maps', title: sectionLabels.maps, paragraphs: ['Server-side map imagery is included only when a configured map renderer/source is available. No imagery is fabricated.'], rows: [['Location', subject.name ?? subject.region ?? 'Selected subject'], ['Coordinates', subject.latitude != null ? `${subject.latitude}, ${subject.longitude}` : 'Unavailable'], ['Area', subject.areaKm2 != null ? `${subject.areaKm2} km²` : 'Unavailable']] });
  if (selected.has('mining')) sections.push({ id: 'mining', title: sectionLabels.mining, rows: [['Record type', subject.recordType ?? 'Unavailable'], ['Status', subject.status ?? 'Unavailable'], ['Ore grade', data.mining.oreGrade?.status === 'unavailable' ? 'Unavailable' : `${data.mining.oreGrade.value} ${data.mining.oreGrade.unit}`], ['Production', data.mining.production?.status === 'unavailable' ? 'Unavailable' : `${data.mining.production.value} ${data.mining.production.unit}`]] });
  if (selected.has('geology')) sections.push({ id: 'geology', title: sectionLabels.geology, paragraphs: [typeof data.mining.geology === 'string' ? data.mining.geology : data.mining.geology.reason] });
  if (selected.has('ai')) sections.push({ id: 'ai', title: sectionLabels.ai, rows: [['Prospectivity', pred?.prospectivityScore != null ? `${pred.prospectivityScore}/100` : 'Unavailable'], ['Confidence', pred?.confidence != null ? `${pred.confidence}%` : 'Unavailable'], ['Uncertainty', pred?.uncertainty != null ? `${pred.uncertainty}` : 'Unavailable'], ['Input dataset', pred?.inputDatasetVersion ?? 'Unavailable']] });
  if (selected.has('spectral')) sections.push({ id: 'spectral', title: sectionLabels.spectral, paragraphs: [data.spectral.status === 'unavailable' ? data.spectral.reason : 'Validated spectral analysis is available in the linked spectral dataset.'] });
  if (selected.has('model')) sections.push({ id: 'model', title: sectionLabels.model, rows: [['Model', model.name ? `${model.name} v${model.version}` : 'Unavailable'], ['Training dataset', model.trainingDataset ?? 'Unavailable'], ['Validation metrics', model.metrics ? JSON.stringify(model.metrics) : 'Unavailable']] });
  if (selected.has('sources')) sections.push({ id: 'sources', title: sectionLabels.sources, rows: data.sources.length ? data.sources.map((s: any) => [s.name, s.url ?? 'No source URL recorded']) : [['Sources', 'No source records attached to this report subject.']] });
  if (selected.has('limits')) sections.push({ id: 'limits', title: sectionLabels.limits, bullets: ['AI prospectivity is a model prediction, not reserve confirmation.', 'Missing datasets are reported as unavailable rather than inferred.', 'Reported resource/grade values retain their source context and are not converted into unsupported estimates.'] });
  return { title: report.title, reportType: report.reportType, subjectType: report.subjectType, subjectId: report.subjectId, sections, generatedAt: new Date().toISOString() };
}
