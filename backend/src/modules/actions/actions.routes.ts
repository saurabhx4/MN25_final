import { Router } from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { getActionPlan, listRecommendations, listActions, approveAction, rejectAction, scheduleAction, completeAction, getDecisionFactors } from './actions.service';

export const actionsRouter = Router();
actionsRouter.use(requireAuth);
const actionPlanQueue = new Queue('action-plan-jobs', { connection: { url: env.redisUrl } });

const contextSchema = z.record(z.unknown()).refine(v => typeof v.source === 'string' && v.source.trim().length > 0, { message: 'Every supplied context must include a non-empty source.' });
const generateBody = z.object({
  mineId: z.string().uuid().optional(), date: z.string().datetime().optional(),
  analysisContext: contextSchema.optional(), productionContext: contextSchema.optional(),
  riskContext: contextSchema.optional(), weatherContext: contextSchema.optional(),
}).refine(v => !!v.analysisContext || !!v.productionContext || !!v.riskContext || !!v.weatherContext, { message: 'At least one sourced analysis/operational context is required.' });
const listQuery = z.object({
  mineId: z.string().uuid().optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});
const notesBody = z.object({ notes: z.string().max(2000).optional() });
const rejectBody = z.object({ reason: z.string().max(2000).optional() });
const scheduleBody = z.object({ scheduledFor: z.string().datetime(), assignedTeam: z.string().max(200).optional(), notes: z.string().max(2000).optional() });
const completeBody = z.object({ executionResult: z.unknown().optional() });

actionsRouter.post('/action-plans/generate', requireRole('ADMIN', 'RESEARCHER'), async (req, res, next) => {
  try {
    const body = generateBody.parse(req.body);
    if (body.mineId) {
      const mine = await prisma.mine.findFirst({ where: { id: body.mineId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!mine) return res.status(404).json({ error: 'not_found', message: 'Mine not found in the current organization.' });
    }
    const plan = await prisma.actionPlan.create({
      data: {
        organizationId: req.user!.organizationId, requestedByUserId: req.user!.id, mineId: body.mineId,
        planDate: body.date ? new Date(body.date) : new Date(), status: 'QUEUED',
        inputContext: { analysisContext: body.analysisContext ?? null, productionContext: body.productionContext ?? null, riskContext: body.riskContext ?? null, weatherContext: body.weatherContext ?? null },
      },
    });
    await actionPlanQueue.add('generate-action-plan', { actionPlanId: plan.id }, { removeOnComplete: 100, removeOnFail: 100 });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'projects.action_plan.requested', resourceType: 'ActionPlan', resourceId: plan.id, metadata: { mineId: body.mineId ?? null } });
    res.status(202).json({ actionPlanId: plan.id, status: plan.status });
  } catch (err) { next(err); }
});

actionsRouter.get('/action-plans/:id', async (req, res, next) => {
  try { const plan = await getActionPlan(req.user!.organizationId, req.params.id); if (!plan) return res.status(404).json({ error: 'not_found', message: 'Action plan not found.' }); res.json(plan); } catch (err) { next(err); }
});
actionsRouter.get('/action-plans/:id/factors', async (req, res, next) => {
  try { const factors = await getDecisionFactors(req.user!.organizationId, req.params.id); if (!factors) return res.status(404).json({ error: 'not_found', message: 'Action plan not found.' }); res.json({ results: factors }); } catch (err) { next(err); }
});
actionsRouter.get('/recommendations', async (req, res, next) => {
  try { const q = listQuery.parse(req.query); const results = await listRecommendations({ organizationId: req.user!.organizationId, ...q }); res.json({ results }); } catch (err) { next(err); }
});
actionsRouter.get('/', async (req, res, next) => {
  try { const q = listQuery.parse(req.query); const results = await listActions({ organizationId: req.user!.organizationId, ...q }); res.json({ results }); } catch (err) { next(err); }
});

actionsRouter.post('/:id/approve', requireRole('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { const body = notesBody.parse(req.body ?? {}); const result = await approveAction({ organizationId: req.user!.organizationId, userId: req.user!.id, actionId: req.params.id, notes: body.notes }); if (!result) return res.status(404).json({ error: 'not_found', message: 'Action not found.' }); res.json(result); } catch (err) { next(err); }
});
actionsRouter.post('/:id/reject', requireRole('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { const body = rejectBody.parse(req.body ?? {}); const result = await rejectAction({ organizationId: req.user!.organizationId, userId: req.user!.id, actionId: req.params.id, reason: body.reason }); if (!result) return res.status(404).json({ error: 'not_found', message: 'Action not found.' }); res.json(result); } catch (err) { next(err); }
});
actionsRouter.post('/:id/schedule', requireRole('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { const body = scheduleBody.parse(req.body); const result = await scheduleAction({ organizationId: req.user!.organizationId, userId: req.user!.id, actionId: req.params.id, scheduledFor: new Date(body.scheduledFor), assignedTeam: body.assignedTeam, notes: body.notes }); if (!result) return res.status(404).json({ error: 'not_found', message: 'Action not found.' }); res.json(result); } catch (err) { next(err); }
});
actionsRouter.post('/:id/complete', requireRole('ADMIN', 'MANAGER', 'OPERATOR'), async (req, res, next) => {
  try { const body = completeBody.parse(req.body ?? {}); const result = await completeAction({ organizationId: req.user!.organizationId, userId: req.user!.id, actionId: req.params.id, executionResult: body.executionResult }); if (!result) return res.status(404).json({ error: 'not_found', message: 'Action not found.' }); res.json(result); } catch (err) { next(err); }
});
