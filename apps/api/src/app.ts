import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './config/rate-limits.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createRateLimiter, passThrough } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { createPdfUpload } from './middleware/upload.js';
import { createAnalysisRouter } from './routes/analysis.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createPlanRouter } from './routes/plan.routes.js';
import { createMaterialRouter } from './routes/material.routes.js';
import { createSetupRouter } from './routes/setup.routes.js';
import { createHealthService, type DatabasePing } from './services/health.service.js';
import type { AnalysisService } from './services/analysis.service.js';
import type { PlanService } from './services/plan.service.js';
import type { MaterialService } from './services/material.service.js';
import type { SetupService } from './services/setup.service.js';

export interface AppDependencies {
  db: DatabasePing;
  version: string;
  setup: SetupService;
  materials: MaterialService;
  analysis: AnalysisService;
  plans: PlanService;
  /** Set to false to disable rate limiting (tests). Defaults to DEFAULT_RATE_LIMITS. */
  rateLimits?: RateLimits | false;
}

/**
 * Builds the Express app from its dependencies. Nothing here opens a port or a database
 * connection, so tests can create an app with fakes.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  // On Render the app sits behind one proxy; without this every client would share the proxy's IP
  // and the per-IP rate limiter would throttle everyone together.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  // Pasted study text is the largest JSON body we expect (the character limit is enforced by the service).
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  const limits = deps.rateLimits === undefined ? DEFAULT_RATE_LIMITS : deps.rateLimits;
  const limitUploads = limits ? createRateLimiter(limits.uploads) : passThrough;
  const limitProfiles = limits ? createRateLimiter(limits.profiles) : passThrough;
  const limitAnalysis = limits ? createRateLimiter(limits.analysis) : passThrough;
  const limitPlanning = limits ? createRateLimiter(limits.planning) : passThrough;

  app.use('/api/health', createHealthRouter(createHealthService(deps.db, deps.version)));
  app.use('/api', createSetupRouter(deps.setup, limitProfiles));
  app.use(
    '/api',
    createMaterialRouter(deps.materials, {
      limitUploads,
      pdfUpload: createPdfUpload(deps.materials.limits),
    }),
  );

  app.use('/api', createAnalysisRouter(deps.analysis, { limitAnalysis }));
  app.use('/api', createPlanRouter(deps.plans, { limitPlanning }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
