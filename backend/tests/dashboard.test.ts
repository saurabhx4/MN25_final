import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    zone: { findFirst: jest.fn(), count: jest.fn() },
    prospectivityPrediction: { findFirst: jest.fn(), findMany: jest.fn() },
    manganeseObservation: { findMany: jest.fn() },
    analysisJob: { findMany: jest.fn() },
    systemComponentStatus: { findMany: jest.fn() },
  },
}));

jest.mock('../src/lib/cache', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheInvalidate: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../src/lib/prisma');
import { createApp } from '../src/app';
import { env } from '../src/config/env';

const app = createApp();

function tokenFor(overrides: Partial<{ id: string; organizationId: string; role: string }> = {}) {
  return jwt.sign(
    { id: 'user-1', organizationId: 'org-1', role: 'RESEARCHER', ...overrides },
    env.jwtSecret
  );
}

describe('GET /api/dashboard/summary', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('returns an "unavailable" block instead of fabricating a prediction when none exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', lastSelectedZoneId: null });
    prisma.prospectivityPrediction.findFirst.mockResolvedValue(null);
    prisma.zone.count.mockResolvedValue(0);
    prisma.analysisJob.findMany.mockResolvedValue([]);
    prisma.systemComponentStatus.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body.selectedLocation.status).toBe('unavailable');
    expect(res.body.predictedMnConcentration.status).toBe('unavailable');
    expect(res.body.systemStatus.status).toBe('unavailable');
  });

  it('scopes zone counts to the authenticated user organization', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', lastSelectedZoneId: null });
    prisma.prospectivityPrediction.findFirst.mockResolvedValue(null);
    prisma.zone.count.mockResolvedValue(2);
    prisma.analysisJob.findMany.mockResolvedValue([]);
    prisma.systemComponentStatus.findMany.mockResolvedValue([]);

    await request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${tokenFor({ organizationId: 'org-42' })}`);

    expect(prisma.zone.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mine: { organizationId: 'org-42' } }) })
    );
  });
});

describe('GET /api/dashboard/top-zones', () => {
  it('validates the sort parameter', async () => {
    const res = await request(app)
      .get('/api/dashboard/top-zones?sort=not-a-real-sort')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(500); // zod parse error surfaces via errorHandler as internal_error unless caught explicitly
  });

  it('returns zones ordered by prospectivity by default', async () => {
    prisma.prospectivityPrediction.findMany.mockResolvedValue([
      {
        prospectivityScore: 92,
        confidence: 91,
        predictedMnConcentration: 5.8,
        createdAt: new Date(),
        zone: { id: 'A', name: 'Keonjhar North', region: 'Odisha, India', latitude: 21.45, longitude: 85.72, areaKm2: 12.4, status: 'AVAILABLE' },
      },
    ]);

    const res = await request(app).get('/api/dashboard/top-zones').set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Keonjhar North');
    expect(res.body[0].risk).toBeNull(); // never fabricated when the risk module hasn't scored it
  });
});

describe('GET /api/dashboard/manganese-distribution', () => {
  it('never mixes observed/modelled/predicted values', async () => {
    prisma.manganeseObservation.findMany.mockResolvedValue([
      { kind: 'OBSERVED', binLabel: '3-4', measuredAt: new Date() },
      { kind: 'PREDICTED', binLabel: '3-4', measuredAt: new Date() },
    ]);
    const res = await request(app).get('/api/dashboard/manganese-distribution').set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body.observed).toEqual([{ label: '3-4', value: 1 }]);
    expect(res.body.predicted).toEqual([{ label: '3-4', value: 1 }]);
    expect(res.body.modelled).toEqual([]);
  });

  it('reports unavailable rather than an empty chart when there is no data', async () => {
    prisma.manganeseObservation.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/dashboard/manganese-distribution').set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.body.status).toBe('unavailable');
  });
});
