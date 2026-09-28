import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { getSpectralProvider } from '../lib/spectral/spectral.provider';
import { registerModelVersion } from '../modules/models/model.service';

// Processes SpectralAnalysis rows created by POST /api/spectral-analysis.
// Only ever writes real output from the configured spectral engine
// (SPECTRAL_ENGINE_URL) or an explicit failure/unavailable state — never a
// fabricated band statistic, index, or anomaly map.
export const spectralWorker = new Worker(
  'spectral-jobs',
  async (job) => {
    const { spectralAnalysisId } = job.data as { spectralAnalysisId: string };
    const analysis = await prisma.spectralAnalysis.findUniqueOrThrow({ where: { id: spectralAnalysisId } });
    await prisma.spectralAnalysis.update({ where: { id: spectralAnalysisId }, data: { status: 'RUNNING' } });

    try {
      const provider = getSpectralProvider();
      if (!provider.configured) {
        await prisma.spectralAnalysis.update({
          where: { id: spectralAnalysisId },
          data: { status: 'UNAVAILABLE', unavailableReason: 'SPECTRAL_ENGINE_URL is not configured.', completedAt: new Date() },
        });
        return;
      }

      const result = await provider.analyze({
        sceneId: analysis.sceneId ?? undefined,
        geometry: (analysis.geometry as { type: 'Polygon'; coordinates: number[][][] } | null) ?? undefined,
        bands: (analysis.bandConfiguration as { bands?: string[] } | null)?.bands,
        indices: (analysis.bandConfiguration as { indices?: string[] } | null)?.indices,
      });

      const { version: modelVersion } = await registerModelVersion({
        organizationId: analysis.organizationId,
        name: result.modelName,
        version: result.modelVersion,
        type: 'PROSPECTIVITY',
        description: 'Spectral feature extraction model',
      });
      const dataSource = await prisma.dataSource.upsert({
        where: { name_datasetVersion: { name: result.dataSourceName, datasetVersion: result.dataSourceDatasetVersion } },
        update: {},
        create: { name: result.dataSourceName, type: 'SPECTRAL', datasetVersion: result.dataSourceDatasetVersion },
      });

      await prisma.spectralAnalysis.update({
        where: { id: spectralAnalysisId },
        data: {
          status: 'COMPLETED',
          sceneId: result.sceneId,
          modelVersionId: modelVersion.id,
          dataSourceId: dataSource.id,
          bandStatistics: result.bandStatistics,
          indices: result.indices,
          anomalyMap: result.anomalyMap ?? undefined,
          spectralSignatures: result.spectralSignatures ?? undefined,
          pixelDistributions: result.pixelDistributions ?? undefined,
          qualityMetrics: result.qualityMetrics,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.spectralAnalysis.update({
        where: { id: spectralAnalysisId },
        data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Unknown error', completedAt: new Date() },
      });
      throw err;
    }
  },
  { connection: { url: env.redisUrl } }
);
