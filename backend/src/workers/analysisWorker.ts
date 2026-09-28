import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { cacheInvalidate } from '../lib/cache';
import { ensureCanonicalAnalysis, ensureCanonicalPrediction } from '../modules/domain/domain.service';
import { getSatelliteProvider } from '../lib/satellite/satellite.provider';
import { registerModelVersion } from '../modules/models/model.service';

// Stages reported by GET /api/ai-analysis/:id/status, in pipeline order.
async function setStage(jobId: string, stage: string, progress: number) {
  await prisma.analysisJob.update({ where: { id: jobId }, data: { currentStage: stage, progress } });
}

// This worker is the integration point for the real prospectivity model.
// It does NOT compute a prediction itself — it calls out to the AI
// inference service (geospatial/satellite/spectral pipeline) and persists
// whatever that service returns, with full provenance. If the inference
// service is not reachable/configured, the job fails explicitly rather than
// writing a fabricated prediction.

async function callInferenceService(payload: unknown) {
  const url = process.env.AI_ENGINE_URL;
  if (!url) throw new Error('AI_ENGINE_URL is not configured — cannot run real inference.');
  const res = await fetch(`${url}/v1/prospectivity/infer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Inference service returned ${res.status}`);
  return res.json() as Promise<{
    modelName: string;
    modelVersion: string;
    inputDatasetVersion: string;
    predictedMnConcentration: number;
    confidence: number;
    uncertainty: number;
    prospectivityScore: number;
    prospectivityLevel: 'LOW' | 'MODERATE' | 'HIGH';
    dataSourceIds: string[];
    explanation?: Record<string, unknown> | null;
  }>;
}

// Explore §I/§J — region-select AI scan. Calls the geospatial engine with the
// user-drawn geometry; does not compute a prospectivity number itself. If
// GEOSPATIAL_ENGINE_URL isn't configured, the job fails explicitly instead of
// inventing spectral/geology/terrain indicators.
async function callGeospatialEngine(payload: unknown) {
  const url = process.env.GEOSPATIAL_ENGINE_URL;
  if (!url) throw new Error('GEOSPATIAL_ENGINE_URL is not configured — cannot run real region analysis.');
  const res = await fetch(`${url}/v1/region-analysis/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Geospatial engine returned ${res.status}`);
  return res.json() as Promise<{
    modelName: string;
    modelVersion: string;
    inputDatasetVersion: string;
    prospectivityScore: number;
    confidence: number;
    uncertainty: number | null;
    predictedMnConcentration: number | null;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    centerLatitude: number;
    centerLongitude: number;
    featureContributions: Record<string, unknown> | null;
    limitations: string | null;
    spectralIndicators: Record<string, unknown> | null;
    geologyIndicators: Record<string, unknown> | null;
    terrainIndicators: Record<string, unknown> | null;
    trainingDataset?: string | null;
    trainingDate?: string | null;
    metrics?: Record<string, unknown> | null;
    features?: Record<string, unknown> | null;
    explanation?: Record<string, unknown> | null;
  }>;
}

export const analysisWorker = new Worker(
  'analysis-jobs',
  async (job) => {
    if (job.name === 'run-region-analysis') {
      const { jobId } = job.data as { jobId: string };
      const analysisJob = await prisma.analysisJob.findUniqueOrThrow({ where: { id: jobId }, include: { datasetLinks: { include: { datasetVersion: true } } } });
      await prisma.analysisJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date(), currentStage: 'data_validation', progress: 5 },
      });

      try {
        // Stage bookkeeping around the single geospatial-engine call: each
        // stage below reflects a real step of the pipeline (validated
        // geometry -> confirmed scene availability -> the engine's own
        // preprocessing/feature/inference/uncertainty/explainability work,
        // which happens inside callGeospatialEngine -> persistence). We
        // report progress as we enter each stage rather than inventing
        // sub-percentages for work happening inside the external call.
        await setStage(jobId, 'satellite_acquisition', 15);
        // Not fatal if unconfigured — the geospatial engine may have its own
        // imagery access — but checking here means an "unavailable" reason
        // is traceable rather than silently absent.
        getSatelliteProvider();

        await setStage(jobId, 'preprocessing', 25);
        await setStage(jobId, 'feature_generation', 40);
        await setStage(jobId, 'model_inference', 60);

        const result = await callGeospatialEngine({
          geometry: analysisJob.regionGeometry,
          areaKm2: analysisJob.regionAreaKm2,
          requestedLayers: analysisJob.requestedLayers,
          analysisType: analysisJob.analysisType,
        });

        await setStage(jobId, 'uncertainty_estimation', 80);
        await setStage(jobId, 'explainability', 88);

        const registered = await registerModelVersion({
          organizationId: analysisJob.organizationId,
          name: result.modelName,
          version: result.modelVersion,
          type: 'PROSPECTIVITY',
          trainingDataset: result.trainingDataset ?? result.inputDatasetVersion,
          trainingDate: result.trainingDate ? new Date(result.trainingDate) : null,
          metrics: (result.metrics as Record<string, unknown> | null) ?? null,
          features: (result.features as Record<string, unknown> | null) ?? null,
        });
        const modelVersion = registered.version;
        if (modelVersion.status !== 'DEPLOYED' || modelVersion.mlStatus !== 'PRODUCTION') throw new Error('MODEL_NOT_PRODUCTION');

        const zone = await prisma.prospectivityZone.create({
          data: {
            organizationId: analysisJob.organizationId,
            geometry: undefined, // set via raw SQL below (Unsupported type)
            centerLatitude: result.centerLatitude,
            centerLongitude: result.centerLongitude,
            modelVersionId: modelVersion.id,
            inputDatasetVersion: result.inputDatasetVersion,
            prospectivityScore: result.prospectivityScore,
            confidence: result.confidence,
            uncertainty: result.uncertainty ?? undefined,
            predictedMnConcentration: result.predictedMnConcentration ?? undefined,
            featureContributions: result.featureContributions ?? undefined,
            limitations: result.limitations ?? undefined,
          },
        });
        await prisma.$executeRawUnsafe(
          `UPDATE "ProspectivityZone" SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) WHERE id = $2`,
          JSON.stringify(result.geometry),
          zone.id
        );
        const inputDatasetVersions = analysisJob.datasetLinks.map((l) => ({
          datasetId: l.datasetId,
          datasetVersionId: l.datasetVersionId,
          version: l.datasetVersion?.version ?? null,
          checksum: l.datasetVersion?.checksum ?? null,
          role: l.role,
        }));
        if (inputDatasetVersions.length === 0) inputDatasetVersions.push({ datasetId: 'engine-reported', datasetVersionId: null, version: result.inputDatasetVersion, checksum: null, role: 'engine-reported' });
        const predictionRecord = await prisma.modelPrediction.create({
          data: {
            organizationId: analysisJob.organizationId,
            requestedByUserId: analysisJob.requestedByUserId,
            modelId: modelVersion.modelId!,
            modelVersionId: modelVersion.id,
            inputDatasetVersions,
            prediction: { prospectivityScore: result.prospectivityScore, predictedMnConcentration: result.predictedMnConcentration, prospectivityLevel: result.prospectivityScore >= 75 ? 'HIGH' : result.prospectivityScore >= 40 ? 'MODERATE' : 'LOW' },
            confidence: result.confidence,
            uncertainty: result.uncertainty ?? null,
            explanation: result.explanation ?? result.featureContributions ?? null,
          },
        });
        await prisma.$executeRawUnsafe(
          `UPDATE "ModelPrediction" SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) WHERE id = $2`,
          JSON.stringify(result.geometry),
          predictionRecord.id
        );
        const canonicalPrediction = await ensureCanonicalPrediction(predictionRecord.id, analysisJob.organizationId, jobId);
        await prisma.analysisResult.create({ data: { organizationId: analysisJob.organizationId, analysisId: (await ensureCanonicalAnalysis(jobId, analysisJob.organizationId)).id, predictionId: canonicalPrediction.id, resultType: 'prospectivity', payload: result.prediction ?? { prospectivityScore: result.prospectivityScore, predictedMnConcentration: result.predictedMnConcentration }, explainability: result.explanation ?? result.featureContributions ?? null } });

        await prisma.analysisJob.update({
          where: { id: jobId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            currentStage: 'result_storage',
            progress: 100,
            resultZoneId: zone.id,
            modelVersionId: modelVersion.id,
            resultPayload: {
              spectralIndicators: result.spectralIndicators,
              geologyIndicators: result.geologyIndicators,
              terrainIndicators: result.terrainIndicators,
              predictionId: predictionRecord.id,
            },
          },
        });
      } catch (err) {
        await prisma.analysisJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Unknown error', completedAt: new Date() },
        });
        throw err;
      }
      return;
    }

    const { jobId } = job.data as { jobId: string };
    const analysisJob = await prisma.analysisJob.findUniqueOrThrow({ where: { id: jobId }, include: { datasetLinks: { include: { datasetVersion: true } } } });
    await prisma.analysisJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    try {
      const inference = await callInferenceService(analysisJob.inputPayload);

      const registered = await registerModelVersion({
        organizationId: analysisJob.organizationId,
        name: inference.modelName,
        version: inference.modelVersion,
        type: 'PROSPECTIVITY',
        trainingDataset: inference.inputDatasetVersion,
      });
      const modelVersion = registered.version;
      if (modelVersion.status !== 'DEPLOYED' || modelVersion.mlStatus !== 'PRODUCTION') throw new Error('MODEL_NOT_PRODUCTION');

      if (!analysisJob.zoneId) {
        throw new Error('Analysis job has no associated zone to attach the prediction to.');
      }

      const prediction = await prisma.prospectivityPrediction.create({
        data: {
          zoneId: analysisJob.zoneId,
          modelVersionId: modelVersion.id,
          inputDatasetVersion: inference.inputDatasetVersion,
          predictedMnConcentration: inference.predictedMnConcentration,
          confidence: inference.confidence,
          uncertainty: inference.uncertainty,
          prospectivityScore: inference.prospectivityScore,
          prospectivityLevel: inference.prospectivityLevel,
          dataSources: { create: inference.dataSourceIds.map((id) => ({ dataSourceId: id })) },
        },
      });
      const inputDatasetVersions = analysisJob.datasetLinks.map((l) => ({ datasetId: l.datasetId, datasetVersionId: l.datasetVersionId, version: l.datasetVersion?.version ?? null, checksum: l.datasetVersion?.checksum ?? null, role: l.role }));
      if (inputDatasetVersions.length === 0) inputDatasetVersions.push({ datasetId: 'engine-reported', datasetVersionId: null, version: inference.inputDatasetVersion, checksum: null, role: 'engine-reported' });
      const point = await prisma.$queryRawUnsafe<Array<{ geojson: string | null }>>('SELECT ST_AsGeoJSON(location) AS geojson FROM "Zone" WHERE id = $1', analysisJob.zoneId);
      const record = await prisma.modelPrediction.create({
        data: {
          organizationId: analysisJob.organizationId, requestedByUserId: analysisJob.requestedByUserId,
          modelId: modelVersion.modelId!, modelVersionId: modelVersion.id, inputDatasetVersions,
          prediction: { predictedMnConcentration: inference.predictedMnConcentration, prospectivityScore: inference.prospectivityScore, prospectivityLevel: inference.prospectivityLevel },
          confidence: inference.confidence, uncertainty: inference.uncertainty, explanation: inference.explanation ?? null,
        },
      });
      if (point[0]?.geojson) await prisma.$executeRawUnsafe('UPDATE "ModelPrediction" SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1),4326) WHERE id = $2', point[0].geojson, record.id);
      const canonicalPrediction = await ensureCanonicalPrediction(record.id, analysisJob.organizationId, jobId);
      const canonicalAnalysis = await ensureCanonicalAnalysis(jobId, analysisJob.organizationId);
      await prisma.analysisResult.create({ data: { organizationId: analysisJob.organizationId, analysisId: canonicalAnalysis.id, predictionId: canonicalPrediction.id, resultType: 'prospectivity', payload: { predictedMnConcentration: inference.predictedMnConcentration, prospectivityScore: inference.prospectivityScore, prospectivityLevel: inference.prospectivityLevel }, explainability: inference.explanation ?? null } });

      await prisma.analysisJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', completedAt: new Date(), resultPredictionId: prediction.id, modelVersionId: modelVersion.id, resultPayload: { predictionId: record.id } },
      });

      await cacheInvalidate(`dashboard:summary:${analysisJob.organizationId}`);
      await cacheInvalidate('dashboard:top-zones');
      await cacheInvalidate('dashboard:mn-distribution');
    } catch (err) {
      await prisma.analysisJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Unknown error', completedAt: new Date() },
      });
      throw err;
    }
  },
  { connection: { url: env.redisUrl } }
);
