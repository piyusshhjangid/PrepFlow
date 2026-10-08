import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimitConfig } from '../config/rate-limits.js';
import { AppError } from '../errors/index.js';

/** Per-IP limiter whose rejection goes through the normal error middleware (same JSON shape as every error). */
export function createRateLimiter(config: RateLimitConfig): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          'RATE_LIMITED',
          'You’re doing that a lot. Please wait a few minutes and try again.',
          429,
          'infrastructure',
        ),
      ),
  });
}

export const passThrough: RequestHandler = (_req, _res, next) => next();
