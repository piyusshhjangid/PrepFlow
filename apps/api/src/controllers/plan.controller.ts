import {
  generatePlanInputSchema,
  rebalanceInputSchema,
  taskActionInputSchema,
  todayQuerySchema,
} from '@prepflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { PlanService } from '../services/plan.service.js';
import { examParamsSchema } from './setup.controller.js';

const taskParamsSchema = z.object({ taskId: z.uuid() });
const topicParamsSchema = z.object({ examId: z.uuid(), topicId: z.uuid() });

/** An absent body (no Content-Type) arrives as undefined/{}: both mean "no options". */
const body = (req: Request): unknown => req.body ?? {};

export function createPlanController(service: PlanService) {
  return {
    async generate(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const input = generatePlanInputSchema.parse(body(req));
      res.status(201).json(await service.generate(examId, input));
    },
    async get(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const { date } = todayQuerySchema.parse(req.query);
      res.json(await service.getPlan(examId, date));
    },
    async today(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const { date } = todayQuerySchema.parse(req.query);
      res.json(await service.getToday(examId, date));
    },
    async rebalance(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const input = rebalanceInputSchema.parse(body(req));
      res.json(await service.rebalance(examId, input));
    },
    async topic(req: Request, res: Response): Promise<void> {
      const { examId, topicId } = topicParamsSchema.parse(req.params);
      const { date } = todayQuerySchema.parse(req.query);
      res.json(await service.getTopic(examId, topicId, date));
    },
    async start(req: Request, res: Response): Promise<void> {
      const { taskId } = taskParamsSchema.parse(req.params);
      res.json(await service.startTask(taskId, taskActionInputSchema.parse(body(req))));
    },
    async complete(req: Request, res: Response): Promise<void> {
      const { taskId } = taskParamsSchema.parse(req.params);
      res.json(await service.completeTask(taskId, taskActionInputSchema.parse(body(req))));
    },
    async skip(req: Request, res: Response): Promise<void> {
      const { taskId } = taskParamsSchema.parse(req.params);
      res.json(await service.skipTask(taskId, taskActionInputSchema.parse(body(req))));
    },
    async uncomplete(req: Request, res: Response): Promise<void> {
      const { taskId } = taskParamsSchema.parse(req.params);
      res.json(await service.uncompleteTask(taskId, taskActionInputSchema.parse(body(req))));
    },
  };
}
