import { defineConfig } from 'vitest/config';

/** Real PostgreSQL. Started by scripts/run-integration-tests.ts, which sets DATABASE_URL to the TEST database. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', AI_PROVIDER: 'fake' },
  },
});
