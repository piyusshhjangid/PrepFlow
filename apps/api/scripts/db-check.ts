/**
 * Verifies, step by step, that the database PrepFlow needs is usable, and explains what to do when not.
 *
 *   npm run db:check          -> development database (DATABASE_URL)
 *   npm run db:check:test     -> test database (TEST_DATABASE_URL)
 *
 * Exit code 0 = everything is fine, 1 = something is wrong (the reason is printed).
 */
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { API_DIR, ENV_FILE_CANDIDATES, loadEnvFiles } from '../src/config/load-env.js';
import { assertSafeTestDatabase } from '../src/config/test-database.js';

const files = loadEnvFiles();
const useTest = process.argv.includes('--test');

function fail(message: string, hint?: string): never {
  console.error(`✗ ${message}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}
function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function describeTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.slice(1)} as user "${decodeURIComponent(parsed.username)}"`;
}

async function main(): Promise<void> {
  // 1. Environment
  if (files.length === 0) {
    fail(
      'No .env file found.',
      `Copy apps/api/.env.example to apps/api/.env. Looked in:\n    ${ENV_FILE_CANDIDATES.join('\n    ')}`,
    );
  }
  ok(`Environment files loaded: ${files.join(', ')}`);

  let url: string | undefined;
  if (useTest) {
    try {
      url = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
    } catch (error) {
      fail((error as Error).message);
    }
  } else {
    url = process.env.DATABASE_URL;
    if (!url) fail('DATABASE_URL is not set.', 'Add it to apps/api/.env (see .env.example).');
  }
  try {
    describeTarget(url);
  } catch {
    fail(
      `${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not a valid URL.`,
      'Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public (URL-encode special characters in the password).',
    );
  }
  ok(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is set → ${describeTarget(url)}`);

  // 2. Connectivity + credentials
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const code =
        (error as { errorCode?: string; code?: string }).errorCode ??
        (error as { code?: string }).code;
      if (code === 'P1000' || code === 'P1010' || /denied|authentication/i.test(String(error))) {
        fail(
          'PostgreSQL is running but rejected the user/password (or the user may not access this database).',
          'Check the credentials, and that the user owns/has access to the database (README: "Database setup").',
        );
      }
      if (code === 'P1003' || /does not exist/i.test(String(error))) {
        fail(
          'The database does not exist.',
          'Create it (README: "Database setup"), e.g. CREATE DATABASE prepflow_test OWNER prepflow;',
        );
      }
      fail(
        `Could not connect to PostgreSQL (${code ?? 'unknown error'}).`,
        'Is PostgreSQL running, and are host and port in the URL correct?',
      );
    }
    ok('Connected to PostgreSQL and authenticated');

    // 3. Migrations applied?
    const migrationsDir = resolve(API_DIR, 'prisma', 'migrations');
    const expected = existsSync(migrationsDir)
      ? readdirSync(migrationsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : [];
    let applied: string[] = [];
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      applied = rows.map((row) => row.migration_name);
    } catch {
      fail(
        'The database has no migration history (tables not created yet).',
        useTest ? 'Run: npm run db:test:setup' : 'Run: npm run db:migrate',
      );
    }
    const pending = expected.filter((name) => !applied.includes(name));
    if (pending.length > 0) {
      fail(
        `${pending.length} migration(s) not applied: ${pending.join(', ')}`,
        useTest ? 'Run: npm run db:test:setup' : 'Run: npm run db:migrate',
      );
    }
    ok(`All ${expected.length} migrations applied`);

    // 4. Schema is usable through Prisma
    const [profiles, runs] = await Promise.all([
      prisma.studyProfile.count(),
      prisma.analysisRun.count(),
    ]);
    ok(`Schema accessible through Prisma (${profiles} profiles, ${runs} analysis runs)`);
    console.log('\nDatabase check passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('✗ Unexpected failure:', error instanceof Error ? error.message : error);
  process.exit(1);
});
