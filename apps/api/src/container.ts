import type { PrismaClient } from '@prisma/client';
import { createAiProvider } from './ai/create-provider.js';
import { chunkConfigFromEnv } from './ai/analysis/config.js';
import { env } from './config/env.js';
import { materialLimitsFromEnv } from './config/limits.js';
import { PrismaMaterialRepository } from './infrastructure/repositories/prisma-material-repository.js';
import { PrismaAnalysisRepository } from './infrastructure/repositories/prisma-analysis-repository.js';
import { PrismaSetupRepository } from './infrastructure/repositories/prisma-setup-repository.js';
import { PdfJsTextExtractor } from './infrastructure/pdf/pdfjs-text-extractor.js';
import { createAnalysisService } from './services/analysis.service.js';
import { PrismaPlanRepository } from './infrastructure/repositories/prisma-plan-repository.js';
import { createPlanService } from './services/plan.service.js';
import { createMaterialService } from './services/material.service.js';
import { createPdfIngestor } from './services/pdf-ingestor.js';
import { createSetupService } from './services/setup.service.js';

/**
 * Composition root: the only place concrete implementations are chosen and wired together.
 * To add OCR later, append an OCR extractor to the `extractors` list below.
 */
export function createServices(prisma: PrismaClient) {
  const limits = materialLimitsFromEnv(env);
  const setupRepo = new PrismaSetupRepository(prisma);
  const materialRepo = new PrismaMaterialRepository(prisma);
  const extractors = [new PdfJsTextExtractor()];
  const provider = createAiProvider(env);

  const analysisRepo = new PrismaAnalysisRepository(prisma);
  const analysis = createAnalysisService({
    setupRepo,
    repo: analysisRepo,
    provider,
    chunkConfig: chunkConfigFromEnv(env),
    retry: { maxAttempts: env.AI_MAX_ATTEMPTS, baseDelayMs: env.AI_RETRY_BASE_DELAY_MS },
    maxConcurrent: env.ANALYSIS_MAX_CONCURRENT,
    staleAfterMs: env.ANALYSIS_STALE_AFTER_MS,
  });

  return {
    setup: createSetupService({ repo: setupRepo }),
    materials: createMaterialService({
      setupRepo,
      materialRepo,
      pdfIngestor: createPdfIngestor(extractors, limits),
      limits,
    }),
    analysis,
    plans: createPlanService({
      setupRepo,
      analysisRepo,
      analysis,
      repo: new PrismaPlanRepository(prisma),
    }),
  };
}
