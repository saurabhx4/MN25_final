function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://mn25:mn25@localhost:5432/mn25'),
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  reportStorageDir: process.env.REPORT_STORAGE_DIR ?? undefined,
  datasetStorageDir: process.env.DATASET_STORAGE_DIR ?? undefined,
  cacheTtl: {
    dashboardSummary: Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL ?? 30),
    topZones: Number(process.env.TOP_ZONES_CACHE_TTL ?? 60),
    mnDistribution: Number(process.env.MN_DISTRIBUTION_CACHE_TTL ?? 120),
  },
};
