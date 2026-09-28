// Combined worker process entrypoint. Run with `npm run worker`.
// Each worker file registers its own BullMQ Worker on import; this file's
// only job is to make sure all of them are actually started together in
// one process (previously only analysisWorker.ts was wired into `npm run
// worker`, so spectral-analysis jobs would have queued forever unprocessed).
import './analysisWorker';
import './spectralWorker';
import './systemHealthWorker';
import './actionPlanWorker';
import './reportWorker';
import './productionForecastWorker';
import './datasetIngestionWorker';
import './mlWorker';

// eslint-disable-next-line no-console
console.log('MN25 workers started: analysis-jobs, spectral-jobs, system-health, action-plan-jobs, report-jobs, production-forecast-jobs, ml-jobs');
