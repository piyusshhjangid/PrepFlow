import { Router, type RequestHandler } from 'express';
import { createAnalysisController } from '../controllers/analysis.controller.js';
import type { AnalysisService } from '../services/analysis.service.js';

/** Mounted at /api. Analyses are scoped by exam; the unguessable exam id is the access key. */
export function createAnalysisRouter(
  service: AnalysisService,
  deps: { limitAnalysis: RequestHandler },
): Router {
  const controller = createAnalysisController(service);
  const router = Router();
  router.post('/exams/:examId/analysis', deps.limitAnalysis, (req, res) =>
    controller.start(req, res),
  );
  router.get('/exams/:examId/analysis/latest', (req, res) => controller.latest(req, res));
  router.get('/exams/:examId/analysis/result', (req, res) => controller.result(req, res));
  router.patch('/exams/:examId/topics/:topicId', (req, res) => controller.updateTopic(req, res));
  router.delete('/exams/:examId/topics/:topicId', (req, res) => controller.deleteTopic(req, res));
  router.get('/analysis-runs/:runId', (req, res) => controller.run(req, res));
  return router;
}
