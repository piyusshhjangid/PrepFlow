/**
 * Runs the Prisma CLI with the SAME environment loading as the API (see src/config/load-env.ts),
 * so `.env` is found wherever it lives and wherever you run npm from.
 *
 *   tsx scripts/prisma-run.ts migrate dev          -> development database (DATABASE_URL)
 *   tsx scripts/prisma-run.ts --test migrate deploy -> test database (TEST_DATABASE_URL)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { API_DIR, loadEnvFiles } from '../src/config/load-env.js';
import { assertSafeTestDatabase } from '../src/config/test-database.js';

loadEnvFiles();
const args = process.argv.slice(2);
const useTest = args[0] === '--test';
if (useTest) args.shift();

const env = { ...process.env };
if (useTest) {
  env.DATABASE_URL = assertSafeTestDatabase(env.TEST_DATABASE_URL, env.DATABASE_URL);
  console.log('Using TEST_DATABASE_URL (test database).');
}
if (!env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and edit it.',
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: API_DIR,
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
