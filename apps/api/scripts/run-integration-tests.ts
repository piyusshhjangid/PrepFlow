/**
 * Runs the PostgreSQL integration suite against the TEST database only.
 * Fails (never skips) when the test database is misconfigured or unreachable.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { API_DIR, loadEnvFiles } from '../src/config/load-env.js';
import { assertSafeTestDatabase } from '../src/config/test-database.js';

loadEnvFiles();
let testUrl: string;
try {
  testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
}

// Make sure the test schema is current, then run the suite.
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const env = { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test', PREPFLOW_INTEGRATION: '1' };
const migrate = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  cwd: API_DIR,
  env,
  stdio: 'inherit',
});
if (migrate.status !== 0) {
  console.error(
    '✗ Could not apply migrations to the test database. Run `npm run db:check:test` for diagnostics.',
  );
  process.exit(1);
}
const vitest = require.resolve('vitest/vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)],
  {
    cwd: API_DIR,
    env,
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
