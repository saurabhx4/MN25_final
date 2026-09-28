import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { saveMapConfigurationBody } from '../../utils/validation';
import { recordAudit } from '../audit/audit.service';

export const mapConfigurationsRouter = Router();
mapConfigurationsRouter.use(requireAuth);

// Explore §K — map layer toggles are UI state and are NOT persisted unless
// the user explicitly saves a configuration via this endpoint.

mapConfigurationsRouter.post('/', async (req, res, next) => {
  try {
    const body = saveMapConfigurationBody.parse(req.body);
    const config = await prisma.mapConfiguration.create({
      data: {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        name: body.name,
        layers: body.layers,
        mapView: body.mapView ?? undefined,
      },
    });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'explore.map_configuration.saved',
      resourceType: 'MapConfiguration',
      resourceId: config.id,
    });
    res.status(201).json(config);
  } catch (err) {
    next(err);
  }
});

mapConfigurationsRouter.get('/', async (req, res, next) => {
  try {
    const configs = await prisma.mapConfiguration.findMany({
      where: { organizationId: req.user!.organizationId, userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ results: configs });
  } catch (err) {
    next(err);
  }
});

mapConfigurationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const config = await prisma.mapConfiguration.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId, userId: req.user!.id },
    });
    if (!config) throw new AppError(404, 'not_found', 'Map configuration not found.');
    await prisma.mapConfiguration.delete({ where: { id: config.id } });
    await recordAudit({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      action: 'explore.map_configuration.deleted',
      resourceType: 'MapConfiguration',
      resourceId: config.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
