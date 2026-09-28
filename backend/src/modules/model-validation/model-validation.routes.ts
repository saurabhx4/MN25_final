import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { modelValidationBody } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';
import { AppError } from '../../middleware/errorHandler';

export const modelValidationRouter = Router();
modelValidationRouter.use(requireAuth);

function prospectivityLevelFromScore(score: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (score >= 75) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}

// POST /api/model-validation — Model Insights tab: computes MAE/RMSE/R² and
// precision/recall directly from GROUND_TRUTH Sample rows matched to the
// ProspectivityZone(s) they reference. If a sample has no matching prediction
// (no regionId, or the region is still queued), it is excluded and reported
// back to the caller rather than silently dropped or approximated.
modelValidationRouter.post('/', async (req, res, next) => {
  try {
    const body = modelValidationBody.parse(req.body);

    const [name, version] = splitModelVersion(body.modelVersion);
    const modelVersion = await prisma.modelVersion.findFirst({ where: { name, version, model: { OR: [{ organizationId: null }, { organizationId: req.user!.organizationId }] } } });
    if (!modelVersion) throw new AppError(404, 'not_found', `Model version "${body.modelVersion}" is not registered — no real analysis has produced it yet.`);

    const samples = await prisma.sample.findMany({
      where: {
        id: { in: body.sampleIds },
        organizationId: req.user!.organizationId,
        kind: 'GROUND_TRUTH',
        ...(body.regionId ? { regionId: body.regionId } : {}),
      },
      include: { region: true },
    });

    const usable = samples.filter((s) => s.region && s.region.modelVersionId === modelVersion.id && s.mnConcentration !== null);
    const skipped = samples.length - usable.length;

    if (usable.length === 0) {
      return res.status(422).json({
        status: 'unavailable',
        reason: 'None of the provided sampleIds have a matching prediction from this model version to validate against.',
        sampleCount: 0,
        skipped: samples.length,
      });
    }

    // Regression metrics: predicted (region.prospectivityScore-derived Mn proxy
    // is NOT used here — only the region's own predictedMnConcentration, if the
    // pipeline produced one, may be compared to ground truth).
    const pairs = usable
      .map((s) => {
        const predicted = s.region!.predictedMnConcentration;
        return predicted !== null ? { observed: s.mnConcentration as number, predicted } : null;
      })
      .filter((p): p is { observed: number; predicted: number } => p !== null);

    let mae: number | null = null;
    let rmse: number | null = null;
    let r2: number | null = null;
    if (pairs.length > 0) {
      const n = pairs.length;
      mae = pairs.reduce((sum, p) => sum + Math.abs(p.observed - p.predicted), 0) / n;
      rmse = Math.sqrt(pairs.reduce((sum, p) => sum + (p.observed - p.predicted) ** 2, 0) / n);
      const meanObserved = pairs.reduce((sum, p) => sum + p.observed, 0) / n;
      const ssTot = pairs.reduce((sum, p) => sum + (p.observed - meanObserved) ** 2, 0);
      const ssRes = pairs.reduce((sum, p) => sum + (p.observed - p.predicted) ** 2, 0);
      r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
    }

    // Classification validation requires explicit binary occurrence/background labels.
    // Mn concentration is never converted into a prospectivity target. This legacy
    // endpoint therefore reports regression validation only when real assay outputs
    // exist; the new ML experiment pipeline owns spatial classification validation.
    const precision: number | null = null;
    const recall: number | null = null;
    const confusionMatrix = null;

    const validation = await prisma.modelValidation.create({
      data: {
        organizationId: req.user!.organizationId,
        requestedByUserId: req.user!.id,
        modelVersionId: modelVersion.id,
        regionId: body.regionId,
        sampleIds: usable.map((s) => s.id),
        validationDatasetVersion: `ground-truth-samples-${new Date().toISOString().slice(0, 10)}`,
        mae, rmse, r2, precision, recall,
        confusionMatrix,
        sampleCount: usable.length,
      },
    });

    await prisma.modelVersion.update({
      where: { id: modelVersion.id },
      data: {
        metrics: { precision, recall, mae, rmse, r2, confusionMatrix, sampleCount: usable.length, validatedAt: validation.validatedAt.toISOString() },
        status: modelVersion.status === 'DEPLOYED' ? 'DEPLOYED' : 'VALIDATED',
        mlStatus: modelVersion.algorithm ? 'VALIDATED' : undefined,
      },
    });
    if (modelVersion.modelId) {
      await prisma.modelRegistry.update({
        where: { id: modelVersion.modelId },
        data: {
          metrics: { precision, recall, mae, rmse, r2, confusionMatrix, sampleCount: usable.length, validatedAt: validation.validatedAt.toISOString() },
          status: modelVersion.status === 'DEPLOYED' ? 'DEPLOYED' : 'VALIDATED',
          currentVersion: modelVersion.version,
          trainingDataset: modelVersion.trainingDataset ?? undefined,
          trainingDate: modelVersion.trainingDate ?? undefined,
          features: modelVersion.features ?? undefined,
        },
      });
    }

    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'ai_analysis.model_validation.requested',
      resourceType: 'ModelValidation',
      resourceId: validation.id,
      metadata: { modelVersion: body.modelVersion, sampleCount: usable.length, skipped },
    });

    res.status(201).json({
      validationId: validation.id,
      precision, recall, mae, rmse, r2,
      confusionMatrix,
      sampleCount: usable.length,
      skipped,
      validationDataset: validation.validationDatasetVersion,
      validationTimestamp: validation.validatedAt,
    });
  } catch (err) {
    next(err);
  }
});

function splitModelVersion(input: string): [string, string] {
  const idx = input.lastIndexOf(' v');
  if (idx === -1) return [input, ''];
  return [input.slice(0, idx), input.slice(idx + 2)];
}
