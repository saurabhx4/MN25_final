import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { ensureSettings, getSettings, updateSettings } from './settings.service';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const updateSchema = z.object({
  selectedMineId: z.string().uuid().nullable().optional(),
  forecastHorizon: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional(),
  riskThreshold: z.coerce.number().min(0).max(100).optional(),
  prospectivityThreshold: z.coerce.number().min(0).max(100).optional(),
  defaultModel: z.string().min(1).max(120).nullable().optional(),
  timezone: z.string().min(1).max(80).optional(),
  units: z.enum(['metric', 'imperial']).optional(),
  notificationPreferences: z.record(z.boolean()).optional(),
  reason: z.string().max(500).optional(),
}).refine(v => Object.keys(v).some(k => k !== 'reason'), { message: 'At least one setting must be supplied.' });

settingsRouter.get('/', async (req, res, next) => {
  try {
    await ensureSettings(req.user!.organizationId, req.user!.id);
    res.json(await getSettings(req.user!.organizationId, req.user!.id));
  } catch (err) { next(err); }
});

settingsRouter.patch('/', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const { reason, ...changes } = body;
    const result = await updateSettings({
      organizationId: req.user!.organizationId, userId: req.user!.id, role: req.user!.role, changes, reason,
    });
    res.json(result);
  } catch (err) { next(err); }
});
