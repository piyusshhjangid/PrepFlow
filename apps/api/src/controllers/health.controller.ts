import type { Request, Response } from 'express';
import type { HealthService } from '../services/health.service.js';

export function createHealthController(service: HealthService) {
  return {
    async get(_req: Request, res: Response): Promise<void> {
      const health = await service.check();
      // 503 when degraded so load balancers and Render health checks can act on it.
      res.status(health.status === 'ok' ? 200 : 503).json(health);
    },
  };
}
