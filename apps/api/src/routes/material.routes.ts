import { Router, type RequestHandler } from 'express';
import { createMaterialController } from '../controllers/material.controller.js';
import type { MaterialService } from '../services/material.service.js';

/** Mounted at /api. Materials are scoped by exam: the unguessable exam id is the access key. */
export function createMaterialRouter(
  service: MaterialService,
  deps: { limitUploads: RequestHandler; pdfUpload: RequestHandler },
): Router {
  const controller = createMaterialController(service);
  const router = Router();
  router.get('/exams/:examId/materials', (req, res) => controller.list(req, res));
  router.post('/exams/:examId/materials/text', deps.limitUploads, (req, res) =>
    controller.addText(req, res),
  );
  router.post('/exams/:examId/materials/pdf', deps.limitUploads, deps.pdfUpload, (req, res) =>
    controller.addPdf(req, res),
  );
  router.delete('/materials/:materialId', (req, res) => controller.remove(req, res));
  return router;
}
