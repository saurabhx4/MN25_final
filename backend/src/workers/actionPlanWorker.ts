import { Worker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { recordAudit } from '../modules/audit/audit.service';

const actionPlanResult = z.object({
  summary: z.string().min(1),
  detectedIssues: z.array(z.unknown()).default([]),
  confidence: z.number().min(0).max(100),
  expectedImpact: z.number().optional(),
  supportingEvidence: z.array(z.unknown()).default([]),
  modelVersion: z.string().min(1),
  factors: z.array(z.object({
    name: z.string().min(1),
    value: z.number().optional(),
    impact: z.number().optional(),
    source: z.string().min(1),
    observedAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  })).default([]),
  recommendations: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    recommendedAction: z.string().min(1),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    confidence: z.number().min(0).max(100),
    estimatedImpact: z.number().optional(),
    sourceAnalysis: z.string().optional(),
    modelVersion: z.string().optional(),
    mineId: z.string().uuid().optional(),
    zone: z.string().optional(),
  })).default([]),
});

async function callActionEngine(inputContext: unknown, organizationId: string, actionPlanId: string) {
  const url = process.env.AI_ENGINE_URL;
  if (!url) throw new Error('AI_ENGINE_URL is not configured — cannot generate a production action plan.');
  const response = await fetch(`${url}/v1/action-plans/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, actionPlanId, context: inputContext }),
  });
  if (!response.ok) throw new Error(`Action engine returned ${response.status}`);
  return actionPlanResult.parse(await response.json());
}

export const actionPlanWorker = new Worker(
  'action-plan-jobs',
  async (job) => {
    const { actionPlanId } = job.data as { actionPlanId: string };
    const plan = await prisma.actionPlan.findUniqueOrThrow({ where: { id: actionPlanId } });
    const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: plan.organizationId } });
    const engineContext = {
      ...((plan.inputContext as Record<string, unknown>) ?? {}),
      settings: settings ? {
        riskThreshold: settings.riskThreshold,
        prospectivityThreshold: settings.prospectivityThreshold,
        forecastHorizon: settings.forecastHorizon,
        defaultModel: settings.defaultModel,
      } : null,
    };

    await prisma.actionPlan.update({ where: { id: plan.id }, data: { status: 'GENERATING', errorMessage: null } });

    try {
      const result = await callActionEngine(engineContext, plan.organizationId, plan.id);

      await prisma.$transaction(async (tx) => {
        await tx.recommendation.deleteMany({ where: { actionPlanId: plan.id } });
        await tx.decisionFactor.deleteMany({ where: { actionPlanId: plan.id } });
        await tx.action.deleteMany({ where: { actionPlanId: plan.id, status: 'PENDING' } });

        await tx.actionPlan.update({
          where: { id: plan.id },
          data: {
            status: 'READY',
            summary: result.summary,
            detectedIssues: result.detectedIssues as any,
            confidence: result.confidence,
            expectedImpact: result.expectedImpact,
            supportingEvidence: result.supportingEvidence as any,
            modelVersion: result.modelVersion,
            generatedAt: new Date(),
          },
        });

        for (const factor of result.factors) {
          await tx.decisionFactor.create({
            data: {
              actionPlanId: plan.id,
              name: factor.name,
              value: factor.value,
              impact: factor.impact,
              source: factor.source,
              observedAt: factor.observedAt ? new Date(factor.observedAt) : undefined,
              metadata: factor.metadata as any,
            },
          });
        }

        for (const rec of result.recommendations) {
          const recommendation = await tx.recommendation.create({
            data: {
              organizationId: plan.organizationId,
              actionPlanId: plan.id,
              mineId: rec.mineId ?? plan.mineId,
              title: rec.title,
              reason: rec.reason,
              recommendedAction: rec.recommendedAction,
              priority: rec.priority,
              confidence: rec.confidence,
              estimatedImpact: rec.estimatedImpact,
              sourceAnalysis: rec.sourceAnalysis,
              modelVersion: rec.modelVersion ?? result.modelVersion,
            },
          });

          await tx.action.create({
            data: {
              organizationId: plan.organizationId,
              actionPlanId: plan.id,
              recommendationId: recommendation.id,
              mineId: rec.mineId ?? plan.mineId,
              title: rec.title,
              description: rec.recommendedAction,
              priority: rec.priority,
              impact: rec.estimatedImpact,
              zone: rec.zone,
              status: 'PENDING',
              createdById: plan.requestedByUserId,
            },
          });
        }
      });

      await recordAudit({
        organizationId: plan.organizationId,
        userId: plan.requestedByUserId,
        action: 'projects.action_plan.generated',
        resourceType: 'ActionPlan',
        resourceId: plan.id,
        metadata: { modelVersion: result.modelVersion, recommendationCount: result.recommendations.length },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown action-plan generation error.';
      await prisma.actionPlan.update({ where: { id: plan.id }, data: { status: 'FAILED', errorMessage: message } });
      await recordAudit({
        organizationId: plan.organizationId,
        userId: plan.requestedByUserId,
        action: 'projects.action_plan.failed',
        resourceType: 'ActionPlan',
        resourceId: plan.id,
        metadata: { error: message },
      });
      throw error;
    }
  },
  { connection: { url: env.redisUrl } },
);
