import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requireAuth } from './middleware/auth';
import { env } from './config/env';
import pinoHttp from 'pino-http';
import { authRouter } from './modules/auth/auth.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { locationsRouter } from './modules/locations/locations.routes';
import { analysesRouter } from './modules/analyses/analyses.routes';
import { samplesRouter } from './modules/samples/samples.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { systemRouter } from './modules/system/system.routes';
import { geospatialRouter } from './modules/geospatial/geospatial.routes';
import { miningRouter } from './modules/mining/mining.routes';
import { prospectivityRouter } from './modules/prospectivity/prospectivity.routes';
import { satelliteRouter } from './modules/satellite/satellite.routes';
import { mapConfigurationsRouter } from './modules/map-configurations/map-configurations.routes';
import { aiAnalysisRouter } from './modules/ai-analysis/ai-analysis.routes';
import { spectralAnalysisRouter } from './modules/spectral-analysis/spectral-analysis.routes';
import { modelsRouter } from './modules/models/models.routes';
import { modelValidationRouter } from './modules/model-validation/model-validation.routes';
import { errorHandler } from './middleware/errorHandler';
import { actionsRouter } from './modules/actions/actions.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { minesRouter } from './modules/mines/mines.routes';
import { productionRouter } from './modules/production/production.routes';
import { risksRouter } from './modules/risks/risks.routes';
import { usersRouter } from './modules/users/users.routes';
import { datasetsRouter } from './modules/datasets/datasets.routes';
import { domainRouter } from './modules/domain/domain.routes';
import { openApiDocument } from './openapi';
import { mlRouter } from './modules/ml/ml.routes';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ redact: ['req.headers.authorization'] }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));

  app.use('/api/auth', authRouter);

  // Cookie-based authentication is protected against cross-site state changes.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path !== '/auth/login' && req.path !== '/auth/register' && req.path !== '/auth/refresh' && req.path !== '/auth/logout') {
      const origin = req.get('origin');
      if (origin && origin !== env.webOrigin) return res.status(403).json({ error: 'csrf_rejected', message: 'Request origin is not trusted.' });
    }
    next();
  });

  // Authentication is mandatory for every non-auth API route. Individual
  // modules add finer-grained permission checks for sensitive operations.
  app.use('/api', (req, res, next) => {
    // A generated report download may use its own short-lived, report-scoped signature.
    // All other API requests require the authenticated application session.
    if (/^\/reports\/[^/]+\/download$/.test(req.path) && typeof req.query.token === 'string') return next();
    return requireAuth(req, res, next);
  });
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/analyses', analysesRouter);
  app.use('/api/samples', samplesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/actions', actionsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/mines', minesRouter);
  app.use('/api/production', productionRouter);
  app.use('/api/risks', risksRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/datasets', datasetsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/geospatial', geospatialRouter);
  app.use('/api/mining', miningRouter);
  app.use('/api/prospectivity', prospectivityRouter);
  app.use('/api/satellite', satelliteRouter);
  app.use('/api/map-configurations', mapConfigurationsRouter);
  app.use('/api/ai-analysis', aiAnalysisRouter);
  app.use('/api/spectral-analysis', spectralAnalysisRouter);
  app.use('/api/models', modelsRouter);
  app.use('/api/model-validation', modelValidationRouter);
  app.use('/api/domain', domainRouter);
  app.use('/api/ml', mlRouter);

  app.use(errorHandler);
  return app;
}
