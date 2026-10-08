import { defineConfig } from 'vitest/config';

/**
 * Unit/HTTP tests: no database is touched. DATABASE_URL here is a placeholder that is never
 * connected to (repositories are in-memory). Integration tests use vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder_test',
      TEST_DATABASE_URL: '',
      CLIENT_URL: 'http://localhost:5173',
      AI_PROVIDER: 'fake',
    },
  },
});
