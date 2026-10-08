import { createProfileInputSchema, updateExamInputSchema } from '@prepflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { SetupService } from '../services/setup.service.js';

export const examParamsSchema = z.object({ examId: z.uuid() });

export function createSetupController(service: SetupService) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const input = createProfileInputSchema.parse(req.body);
      const exam = await service.createProfileWithExam(input);
      res.status(201).json({ profileId: exam.profileId, exam });
    },

    async get(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      res.json(await service.getExam(examId));
    },

    async update(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const input = updateExamInputSchema.parse(req.body);
      res.json(await service.updateExam(examId, input));
    },
  };
}
