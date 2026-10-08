import { DEFAULT_MATERIAL_LIMITS, type MaterialLimits } from '@prepflow/shared';
import type { Express } from 'express';
import { FakeAiProvider } from '../ai/providers/fake-provider.js';
import type { AiProvider } from '../ai/provider.js';
import { createApp } from '../app.js';
import { createAnalysisService, type AnalysisService } from '../services/analysis.service.js';
import type { RateLimits } from '../config/rate-limits.js';
import type { PdfPageExtractor } from '../infrastructure/pdf/pdf-page-extractor.js';
import { PdfJsTextExtractor } from '../infrastructure/pdf/pdfjs-text-extractor.js';
import { createMaterialService } from '../services/material.service.js';
import { createPdfIngestor } from '../services/pdf-ingestor.js';
import type { DatabasePing } from '../services/health.service.js';
import { createPlanService, type PlanService } from '../services/plan.service.js';
import { createSetupService } from '../services/setup.service.js';
import {
  InMemoryAnalysisRepository,
  InMemoryMaterialRepository,
  InMemoryPlanRepository,
  InMemorySetupRepository,
} from './in-memory.js';

export interface TestAppOptions {
  db?: DatabasePing;
  limits?: MaterialLimits;
  rateLimits?: RateLimits | false;
  extractors?: PdfPageExtractor[];
  setupRepo?: InMemorySetupRepository;
  materialRepo?: InMemoryMaterialRepository;
  analysisRepo?: InMemoryAnalysisRepository;
  planRepo?: InMemoryPlanRepository;
  provider?: AiProvider;
  maxConcurrent?: number;
  /** 2026-10-03 (a Saturday) unless overridden. */
  now?: Date;
}

/** A full app wired with in-memory persistence and the REAL pdfjs extractor. */
export function buildTestApp(options: TestAppOptions = {}): {
  app: Express;
  setupRepo: InMemorySetupRepository;
  materialRepo: InMemoryMaterialRepository;
  analysisRepo: InMemoryAnalysisRepository;
  analysis: AnalysisService;
  planRepo: InMemoryPlanRepository;
  plans: PlanService;
} {
  const limits = options.limits ?? DEFAULT_MATERIAL_LIMITS;
  const setupRepo = options.setupRepo ?? new InMemorySetupRepository();
  const materialRepo = options.materialRepo ?? new InMemoryMaterialRepository();
  const analysisRepo = options.analysisRepo ?? new InMemoryAnalysisRepository(materialRepo);
  const analysis = createAnalysisService({
    setupRepo,
    repo: analysisRepo,
    provider: options.provider ?? new FakeAiProvider(['{"subjects":[]}']),
    chunkConfig: { targetChars: 12_000, maxChars: 15_000, maxChunks: 40 },
    retry: { maxAttempts: 3, baseDelayMs: 0 },
    maxConcurrent: options.maxConcurrent ?? 1,
    staleAfterMs: 15 * 60_000,
    sleep: async () => undefined,
  });
  const now = options.now ?? new Date('2026-10-03T10:00:00.000Z');
  const planRepo = options.planRepo ?? new InMemoryPlanRepository();
  const plans = createPlanService({
    setupRepo,
    analysisRepo,
    analysis,
    repo: planRepo,
    clock: () => now,
  });
  const app = createApp({
    db: options.db ?? { $queryRaw: async () => [1] },
    version: 'test',
    setup: createSetupService({ repo: setupRepo, clock: () => now }),
    materials: createMaterialService({
      setupRepo,
      materialRepo,
      pdfIngestor: createPdfIngestor(options.extractors ?? [new PdfJsTextExtractor()], limits),
      limits,
    }),
    analysis,
    plans,
    rateLimits: options.rateLimits ?? false,
  });
  return { app, setupRepo, materialRepo, analysisRepo, analysis, planRepo, plans };
}
