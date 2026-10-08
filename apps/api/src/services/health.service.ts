import type { HealthResponse } from '@prepflow/shared';

/** The slice of Prisma the health check needs. Narrow on purpose so tests can fake it. */
export interface DatabasePing {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
}

export function createHealthService(db: DatabasePing, version: string) {
  return {
    async check(): Promise<HealthResponse> {
      let database: 'up' | 'down' = 'up';
      try {
        await db.$queryRaw`SELECT 1`;
      } catch {
        database = 'down';
      }
      return {
        status: database === 'up' ? 'ok' : 'degraded',
        checks: { database },
        version,
      };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
