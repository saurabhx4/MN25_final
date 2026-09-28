import { prisma } from '../lib/prisma';
import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import { env } from '../config/env';

// Runs on an interval (e.g. via a cron/queue scheduler) and probes each
// subsystem this platform depends on. Each probe is a real check — a DB
// ping, a queue connectivity check, a call to the inference/geospatial/
// satellite/report services' own /health endpoints. Nothing here invents a
// status; a probe that can't run leaves the component UNKNOWN rather than
// guessing OPERATIONAL.

type ComponentKey =
  | 'database'
  | 'ai_engine'
  | 'geospatial_engine'
  | 'satellite_pipeline'
  | 'spectral_engine'
  | 'forecasting_engine'
  | 'report_service'
  | 'storage';

async function probeDatabase(): Promise<{ status: 'OPERATIONAL' | 'DOWN'; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'OPERATIONAL', latencyMs: Date.now() - start };
  } catch {
    return { status: 'DOWN', latencyMs: Date.now() - start };
  }
}

async function probeHttpService(url: string | undefined): Promise<{ status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'; latencyMs: number | null }> {
  if (!url) return { status: 'UNKNOWN', latencyMs: null };
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Date.now() - start;
    return { status: res.ok ? 'OPERATIONAL' : 'DEGRADED', latencyMs };
  } catch {
    return { status: 'DOWN', latencyMs: Date.now() - start };
  }
}

async function upsert(component: ComponentKey, status: string, latencyMs: number | null, message?: string, version?: string | null) {
  await prisma.systemComponentStatus.upsert({
    where: { component },
    update: { status: status as never, latencyMs, message, version: version ?? null, lastCheckedAt: new Date() },
    create: { component, status: status as never, latencyMs, message, version: version ?? null },
  });
  await prisma.systemStatus.upsert({
    where: { component },
    update: { status: status as never, latencyMs, message, version: version ?? null, lastCheckedAt: new Date() },
    create: { component, status: status as never, latencyMs, message, version: version ?? null },
  });
}

export async function runHealthProbes() {
  const db = await probeDatabase();
  await upsert('database', db.status, db.latencyMs);

  const services: Array<[ComponentKey, string | undefined]> = [
    ['ai_engine', process.env.AI_ENGINE_URL],
    ['geospatial_engine', process.env.GEOSPATIAL_ENGINE_URL],
    ['satellite_pipeline', process.env.SATELLITE_PIPELINE_URL],
    ['spectral_engine', process.env.SPECTRAL_ENGINE_URL],
    ['forecasting_engine', process.env.FORECASTING_ENGINE_URL],
    ['report_service', process.env.REPORT_SERVICE_URL],
  ];

  for (const [component, url] of services) {
    const result = await probeHttpService(url);
    await upsert(component, result.status, result.latencyMs, url ? undefined : 'Service URL not configured.', url ? (process.env[`${component.toUpperCase()}_VERSION`] ?? null) : null);
  }

  const storageStart = Date.now();
  try {
    const dir = path.resolve(env.reportStorageDir ?? path.join(process.cwd(), 'storage', 'reports'));
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir, fsConstants.W_OK);
    await upsert('storage', 'OPERATIONAL', Date.now() - storageStart, undefined, process.env.STORAGE_VERSION ?? null);
  } catch (err) {
    await upsert('storage', 'DOWN', Date.now() - storageStart, 'Report storage is not writable.', process.env.STORAGE_VERSION ?? null);
  }
}

if (require.main === module) {
  runHealthProbes()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
