import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';
import type { HealthService } from '../services/health.service.js';

export function createHealthRouter(service: HealthService): Router {
  const controller = createHealthController(service);
  const router = Router();
  router.get('/', (req, res) => controller.get(req, res));
  return router;
}
