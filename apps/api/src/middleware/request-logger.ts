import type { NextFunction, Request, Response } from 'express';
import { logger } from '../infrastructure/logger.js';

/**
 * Logs one line per request: method, path (no query string), status, duration.
 * Uses originalUrl: inside a mounted router `req.path` has the mount prefix stripped
 * (e.g. "/" instead of "/api/health"), which makes logs useless.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });
  next();
}
