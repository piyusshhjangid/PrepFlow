import { Router, type RequestHandler } from 'express';
import { createSetupController } from '../controllers/setup.controller.js';
import type { SetupService } from '../services/setup.service.js';

/** Mounted at /api. `limitCreate` guards workspace creation. */
export function createSetupRouter(service: SetupService, limitCreate: RequestHandler): Router {
  const controller = createSetupController(service);
  const router = Router();
  router.post('/profiles', limitCreate, (req, res) => controller.create(req, res));
  router.get('/exams/:examId', (req, res) => controller.get(req, res));
  router.patch('/exams/:examId', (req, res) => controller.update(req, res));
  return router;
}
