import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../../middleware/auth';
import { recordAudit } from '../audit/audit.service';
import { AppError } from '../../middleware/errorHandler';

export const usersRouter = Router();
usersRouter.use(requirePermission('users.manage'));

const roleBody = z.object({ role: z.enum(['RESEARCHER', 'OPERATOR', 'MANAGER', 'ADMIN']) });
const minesBody = z.object({ mineIds: z.array(z.string().uuid()).max(200) });

usersRouter.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'asc' },
      include: { mineMemberships: true },
    });
    res.json({ results: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, organizationId: u.organizationId, mineIds: u.mineMemberships.map(m => m.mineId), environment: u.environment.toLowerCase(), isActive: u.isActive, createdAt: u.createdAt })) });
  } catch (err) { next(err); }
});

usersRouter.patch('/:id/role', async (req, res, next) => {
  try {
    const { role } = roleBody.parse(req.body);
    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!user) throw new AppError(404, 'not_found', 'User not found in this organization.');
    const updated = await prisma.user.update({ where: { id: user.id }, data: { role } });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'auth.permission_changed', resourceType: 'User', resourceId: user.id, metadata: { previousRole: user.role, newRole: role } });
    res.json({ id: updated.id, role: updated.role });
  } catch (err) { next(err); }
});

usersRouter.patch('/:id/mines', async (req, res, next) => {
  try {
    const { mineIds } = minesBody.parse(req.body);
    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!user) throw new AppError(404, 'not_found', 'User not found in this organization.');
    const valid = await prisma.mine.findMany({ where: { organizationId: req.user!.organizationId, id: { in: mineIds } }, select: { id: true } });
    if (valid.length !== mineIds.length) throw new AppError(400, 'invalid_mines', 'Every mine must belong to the current organization.');
    await prisma.$transaction([
      prisma.userMine.deleteMany({ where: { userId: user.id } }),
      ...mineIds.map(mineId => prisma.userMine.create({ data: { userId: user.id, mineId } })),
    ]);
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'auth.permissions_changed', resourceType: 'User', resourceId: user.id, metadata: { mineIds } });
    res.json({ id: user.id, mineIds });
  } catch (err) { next(err); }
});

usersRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const body = z.object({ isActive: z.boolean() }).parse(req.body);
    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!user) throw new AppError(404, 'not_found', 'User not found in this organization.');
    if (user.id === req.user!.id && !body.isActive) throw new AppError(400, 'invalid_request', 'An administrator cannot deactivate their own account.');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: body.isActive } });
    if (!body.isActive) await prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ organizationId: req.user!.organizationId, userId: req.user!.id, action: 'auth.user_status_changed', resourceType: 'User', resourceId: user.id, metadata: { isActive: body.isActive } });
    res.json({ id: user.id, isActive: body.isActive });
  } catch (err) { next(err); }
});
