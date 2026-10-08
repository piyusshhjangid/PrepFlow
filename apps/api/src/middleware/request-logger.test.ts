import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../test/build-test-app.js';
import { logger } from '../infrastructure/logger.js';

afterEach(() => vi.restoreAllMocks());

describe('requestLogger', () => {
  it('logs the full request path without the query string', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const { app } = buildTestApp();

    await request(app).get('/api/health?token=secret');

    const call = info.mock.calls.find(([message]) => message === 'request');
    expect(call?.[1]).toMatchObject({ method: 'GET', path: '/api/health', status: 200 });
    expect(JSON.stringify(call)).not.toContain('secret');
  });
});
