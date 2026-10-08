import { Router, type RequestHandler } from 'express';
import { createPlanController } from '../controllers/plan.controller.js';
import type { PlanService } from '../services/plan.service.js';

/**
 * Mounted at /api. Plans are scoped by exam and tasks by their own unguessable id; when accounts are
 * added, ownership checks belong in PlanService (it already receives ids only, never trusts bodies).
 */
export function createPlanRouter(
  service: PlanService,
  deps: { limitPlanning: RequestHandler },
): Router {
  const c = createPlanController(service);
  const router = Router();
  router.post('/exams/:examId/plan', deps.limitPlanning, (req, res) => c.generate(req, res));
  router.get('/exams/:examId/plan', (req, res) => c.get(req, res));
  router.get('/exams/:examId/plan/today', (req, res) => c.today(req, res));
  router.post('/exams/:examId/plan/rebalance', deps.limitPlanning, (req, res) =>
    c.rebalance(req, res),
  );
  router.get('/exams/:examId/topics/:topicId', (req, res) => c.topic(req, res));
  router.post('/study-tasks/:taskId/start', (req, res) => c.start(req, res));
  router.post('/study-tasks/:taskId/complete', (req, res) => c.complete(req, res));
  router.post('/study-tasks/:taskId/skip', (req, res) => c.skip(req, res));
  router.post('/study-tasks/:taskId/uncomplete', (req, res) => c.uncomplete(req, res));
  return router;
}
