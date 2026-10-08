import { createTextMaterialInputSchema } from '@prepflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { documentErrors } from '../domain/documents/document-errors.js';
import type { MaterialService } from '../services/material.service.js';
import { examParamsSchema } from './setup.controller.js';

const materialParamsSchema = z.object({ materialId: z.uuid() });

export function createMaterialController(service: MaterialService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      res.json(await service.list(examId));
    },

    async addText(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      const { text } = createTextMaterialInputSchema.parse(req.body);
      const result = await service.addText(examId, text);
      res.status(result.duplicate ? 200 : 201).json(result);
    },

    async addPdf(req: Request, res: Response): Promise<void> {
      const { examId } = examParamsSchema.parse(req.params);
      if (!req.file) throw documentErrors.noFile();
      const result = await service.addPdf(examId, {
        buffer: req.file.buffer,
        originalName: decodeFilename(req.file.originalname),
      });
      res.status(result.duplicate ? 200 : 201).json(result);
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { materialId } = materialParamsSchema.parse(req.params);
      await service.remove(materialId);
      res.status(204).end();
    },
  };
}

/**
 * Multipart filenames arrive as raw bytes that busboy may have decoded as latin1. If re-decoding the
 * bytes as UTF-8 gives clean text, the original was UTF-8 (e.g. a Hindi filename); otherwise keep it.
 * Display-only: the name is never used as a path.
 */
export function decodeFilename(name: string): string {
  const redecoded = Buffer.from(name, 'latin1').toString('utf8');
  return redecoded.includes('\uFFFD') ? name : redecoded;
}
