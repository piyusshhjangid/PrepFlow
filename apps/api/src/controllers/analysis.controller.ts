import type { Request, Response } from 'express';
import { z } from 'zod';
import { reviewTopicInputSchema } from '@prepflow/shared';
import type { AnalysisService } from '../services/analysis.service.js';
import { examParamsSchema } from './setup.controller.js';

const runParamsSchema = z.object({ runId: z.uuid() });
const topicParamsSchema = z.object({ examId: z.uuid(), topicId: z.uuid() });

export function createAnalysisController(service: AnalysisService) {
  return {
    async start(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const result = await service.start(examId);
      // 200 when nothing new was started (reused result or already running), 202 when work was queued.
      res.status(result.reused || result.alreadyRunning ? 200 : 202).json(result);
    },
    async latest(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      res.json(await service.getLatest(examId));
    },
    async result(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      res.json(await service.getResult(examId));
    },
    async updateTopic(req: Request, res: Response): Promise<void> {
      const { examId, topicId } = topicParamsSchema.parse(req.params);
      await service.updateReviewedTopic(examId, topicId, reviewTopicInputSchema.parse(req.body));
      res.json(await service.getResult(examId));
    },
    async deleteTopic(req: Request, res: Response): Promise<void> {
      const { examId, topicId } = topicParamsSchema.parse(req.params);
      await service.deleteReviewedTopic(examId, topicId);
      res.status(204).end();
    },
    async run(req: Request, res: Response): Promise<void> {
      const { runId } = runParamsSchema.parse(req.params);
      res.json(await service.getRun(runId));
    },
  };
}
