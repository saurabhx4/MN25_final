import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';

export const minesRouter = Router();
minesRouter.use(requireAuth);

const mineBody = z.object({ name: z.string().min(1).max(200), region: z.string().min(1).max(200) });

minesRouter.get('/', async (req, res, next) => {
  try {
    const mines = await prisma.mine.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { name: 'asc' }, select: { id: true, name: true, region: true, createdAt: true } });
    res.json({ results: mines });
  } catch (err) { next(err); }
});

minesRouter.get('/:id', async (req, res, next) => {
  try {
    const mine = await prisma.mine.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, include: { zones: { select: { id: true, name: true, region: true, status: true, recordType: true } } } });
    if (!mine) return res.status(404).json({ error: 'not_found', message: 'Mine not found in the current organization.' });
    res.json({ id: mine.id, name: mine.name, region: mine.region, createdAt: mine.createdAt, zones: mine.zones });
  } catch (err) { next(err); }
});

minesRouter.post('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const body = mineBody.parse(req.body);
    const mine = await prisma.mine.create({ data: { organizationId: req.user!.organizationId, name: body.name, region: body.region } });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'mine.created', resourceType: 'Mine', resourceId: mine.id, metadata: body });
    res.status(201).json(mine);
  } catch (err) { next(err); }
});

minesRouter.patch('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const body = mineBody.partial().parse(req.body);
    if (!Object.keys(body).length) return res.status(400).json({ error: 'validation_error', message: 'At least one mine field must be supplied.' });
    const existing = await prisma.mine.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!existing) return res.status(404).json({ error: 'not_found', message: 'Mine not found in the current organization.' });
    const mine = await prisma.mine.update({ where: { id: existing.id }, data: body });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'mine.updated', resourceType: 'Mine', resourceId: mine.id, metadata: { oldValue: existing, newValue: mine } });
    res.json(mine);
  } catch (err) { next(err); }
});
