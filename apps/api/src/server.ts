import { createApp } from './app.js';
import { createServices } from './container.js';
import { env } from './config/env.js';
import { DEFAULT_RATE_LIMITS } from './config/rate-limits.js';
import { logger } from './infrastructure/logger.js';
import { prisma } from './infrastructure/prisma.js';

const version = process.env.npm_package_version ?? '0.1.0';
const services = createServices(prisma);
const app = createApp({
  db: prisma,
  version,
  ...services,
  rateLimits: {
    ...DEFAULT_RATE_LIMITS,
    analysis: {
      windowMs: env.ANALYSIS_RATE_WINDOW_MINUTES * 60_000,
      limit: env.ANALYSIS_RATE_LIMIT,
    },
  },
});

// Fail loudly but helpfully: the most common first-run problem is a database setup mismatch.
prisma.$queryRaw`SELECT 1`.catch((error: unknown) => {
  const code = (error as { errorCode?: string } | null)?.errorCode;
  logger.warn('database unreachable at startup', {
    prismaErrorCode: code,
    hint:
      code === 'P1010' || code === 'P1000'
        ? 'The database is running but rejected the credentials in DATABASE_URL. See "Database setup" in the README.'
        : 'Check that PostgreSQL is running and DATABASE_URL in apps/api/.env is correct. See "Database setup" in the README.',
  });
});

// Analyses left QUEUED/RUNNING by a previous process can never finish; fail them so the UI is honest.
services.analysis.recoverInterrupted().catch((error: unknown) => {
  logger.warn('could not recover interrupted analyses', {
    errorName: error instanceof Error ? error.name : 'unknown',
  });
});

const server = app.listen(env.PORT, () => {
  logger.info('api listening', { port: env.PORT, env: env.NODE_ENV });
});

/** Connections that never finish (keep-alive, a hung request) must not block a deploy forever. */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  const forceExit = setTimeout(() => {
    logger.warn('shutdown timed out; exiting', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();
  server.close(() => {
    prisma
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// A rejected promise nobody awaited is a bug, but it must be logged (without request data) rather
// than silently swallowed or crashing with a raw stack trace; an uncaught exception leaves the
// process in an unknown state, so it is logged and the process exits for the host to restart.
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled rejection', {
    errorName: reason instanceof Error ? reason.name : typeof reason,
    errorMessage: reason instanceof Error ? reason.message : String(reason),
  });
});
process.on('uncaughtException', (error: Error) => {
  logger.error('uncaught exception', { errorName: error.name, errorMessage: error.message });
  process.exit(1);
});
