import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/index.js';
import { logger } from '../infrastructure/logger.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = {
    error: { code: 'ROUTE_NOT_FOUND', message: 'That endpoint doesn’t exist.' },
  };
  res.status(404).json(body);
}

/**
 * The single place where errors become HTTP responses.
 * - AppError: its message is user-safe by contract.
 * - ZodError: a validation failure that escaped a service; reported as 400.
 * - body-parser errors (malformed JSON, payload too large): mapped to clear 4xx codes.
 * - anything else: logged in full server-side, generic message to the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    logger.warn('handled error', {
      code: err.code,
      category: err.category,
      method: req.method,
      path: req.path,
    });
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some of the information you sent isn’t valid.',
        details: err.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    };
    res.status(400).json(body);
    return;
  }

  const httpError = err as { type?: string; status?: number } | null;
  if (httpError?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'The request body isn’t valid JSON.' },
    } satisfies ErrorBody);
    return;
  }
  if (httpError?.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large to process.' },
    } satisfies ErrorBody);
    return;
  }

  logger.error('unexpected error', {
    method: req.method,
    path: req.path,
    errorName: err instanceof Error ? err.name : typeof err,
    errorMessage: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something unexpected went wrong on our side. Please try again.',
    },
  } satisfies ErrorBody);
}
