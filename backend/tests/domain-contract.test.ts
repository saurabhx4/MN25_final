import request from 'supertest';
import { createApp } from '../src/app';

describe('MN25 unified domain security contracts', () => {
  const app = createApp();

  test('canonical graph requires an authenticated session', async () => {
    const response = await request(app).get('/api/domain/organizations/me/graph');
    expect(response.status).toBe(401);
  });

  test('canonical provenance endpoints require authentication', async () => {
    const response = await request(app).get('/api/domain/predictions/not-a-real-id/provenance');
    expect(response.status).toBe(401);
  });

  test('OpenAPI document is available', async () => {
    const response = await request(app).get('/api/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths['/domain/predictions/{id}/provenance']).toBeDefined();
  });
});
