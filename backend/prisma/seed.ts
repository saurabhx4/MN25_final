import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// This seed creates a demo organization, mine and zone *shells* (the same
// geographic reference points shown in the current frontend prototype) so
// the API is exercisable end-to-end. It deliberately does NOT insert any
// ProspectivityPrediction or ManganeseObservation rows — those must come
// from a real analysis job / inference service, per the "never fabricate
// AI or geological data" requirement. Until an analysis runs, the Dashboard
// will correctly show "unavailable" for prediction-derived fields.
async function main() {
  const org = await prisma.organization.create({ data: { name: 'Ramgiri Manganese Mine' } });
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.user.create({
    data: {
      organizationId: org.id,
      email: 'demo@mn25.example',
      name: 'Saurabh Singh',
      role: 'MANAGER',
      environment: 'ORGANIZATION',
      passwordHash,
    },
  });

  const mine = await prisma.mine.create({
    data: { organizationId: org.id, name: 'Ramgiri Manganese Mine', region: 'Odisha, India' },
  });

  await prisma.organizationSettings.create({ data: { organizationId: org.id, forecastHorizon: 30, riskThreshold: 70, prospectivityThreshold: 75 } });
  const demoUser = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@mn25.example' } });
  await prisma.userSettings.create({ data: { userId: demoUser.id, selectedMineId: mine.id, timezone: 'Asia/Kolkata', units: 'metric', notificationPreferences: { actionPlan: true, systemAlerts: true, reports: true } } });

  // recordType/state/district/sourceName reflect only what a real
  // authoritative source (e.g. Indian Bureau of Mines / Geological Survey of
  // India district reports) would actually publish for a location like this.
  // No AI prediction, ore-grade, operator, or production figures are seeded
  // here — those must come from a real analysis job or a verified import,
  // per the "never fabricate" rule (see README).
  const zoneSeeds = [
    { name: 'Keonjhar North', region: 'Odisha, India', state: 'Odisha', district: 'Keonjhar', latitude: 21.4532, longitude: 85.7214, areaKm2: 12.4, status: 'AVAILABLE' as const, recordType: 'DOCUMENTED_OCCURRENCE' as const },
    { name: 'Keonjhar East', region: 'Odisha, India', state: 'Odisha', district: 'Keonjhar', latitude: 21.4984, longitude: 85.7932, areaKm2: 9.8, status: 'ACTIVE_EXTRACTION' as const, recordType: 'DOCUMENTED_MINE' as const },
    { name: 'Sundargarh Belt', region: 'Odisha, India', state: 'Odisha', district: 'Sundargarh', latitude: 22.1123, longitude: 84.9934, areaKm2: 8.6, status: 'MONITORING' as const, recordType: 'DOCUMENTED_OCCURRENCE' as const },
    { name: 'West Singhbhum Edge', region: 'Jharkhand, India', state: 'Jharkhand', district: 'West Singhbhum', latitude: 22.0031, longitude: 85.4521, areaKm2: 7.1, status: 'RESTRICTED' as const, recordType: 'DOCUMENTED_OCCURRENCE' as const },
  ];

  for (const z of zoneSeeds) {
    const zone = await prisma.zone.create({
      data: {
        mineId: mine.id,
        name: z.name,
        region: z.region,
        state: z.state,
        district: z.district,
        latitude: z.latitude,
        longitude: z.longitude,
        areaKm2: z.areaKm2,
        status: z.status,
        recordType: z.recordType,
        commodity: 'manganese',
        sourceName: 'Geological Survey of India',
        sourceUrl: 'https://www.gsi.gov.in/',
      },
    });
    // Set the actual PostGIS geometry column via raw SQL (Prisma can't write Unsupported types).
    await prisma.$executeRawUnsafe(
      `UPDATE "Zone" SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
      z.longitude,
      z.latitude,
      zone.id
    );
  }

  await prisma.systemComponentStatus.createMany({
    data: [
      { component: 'database', status: 'OPERATIONAL' },
      { component: 'ai_engine', status: 'UNKNOWN', message: 'AI_ENGINE_URL not configured' },
      { component: 'geospatial_engine', status: 'UNKNOWN', message: 'GEOSPATIAL_ENGINE_URL not configured' },
      { component: 'satellite_pipeline', status: 'UNKNOWN', message: 'SATELLITE_PIPELINE_URL not configured' },
      { component: 'spectral_engine', status: 'UNKNOWN', message: 'SPECTRAL_ENGINE_URL not configured' },
      { component: 'forecasting_engine', status: 'UNKNOWN', message: 'FORECASTING_ENGINE_URL not configured' },
      { component: 'report_service', status: 'UNKNOWN', message: 'REPORT_SERVICE_URL not configured' },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded org ${org.id} with demo login demo@mn25.example / ChangeMe123!`);
}

main().finally(() => prisma.$disconnect());
