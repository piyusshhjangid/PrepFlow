import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './test/build-test-app.js';
import type { DatabasePing } from './services/health.service.js';

const healthyDb: DatabasePing = { $queryRaw: async () => [{ '?column?': 1 }] };
const brokenDb: DatabasePing = {
  $queryRaw: async () => {
    throw new Error('connection refused: secret-internal-detail');
  },
};

describe('GET /api/health', () => {
  it('reports ok when the database responds', async () => {
    const res = await request(buildTestApp({ db: healthyDb }).app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up' }, version: 'test' });
  });

  it('reports degraded (503) without leaking internal errors when the database is down', async () => {
    const res = await request(buildTestApp({ db: brokenDb }).app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database).toBe('down');
    expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail');
  });
});

describe('error handling', () => {
  const app = buildTestApp({ db: healthyDb }).app;

  it('returns a structured 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns a clear 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 when the body exceeds the limit', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(1_200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
