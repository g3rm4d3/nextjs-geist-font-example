import type { ApiErrorResponse } from '@rideshare/types';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { AppError, NotFoundError } from '../lib/errors';

/** Mounted after all routes: turns any unmatched request into a 404 AppError. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
}

/**
 * Centralized error handler. Every thrown/rejected error in a route handler
 * ends up here (Express 5 auto-forwards rejected async handlers) so no
 * individual route needs its own try/catch-and-format boilerplate.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'An unexpected error occurred';

  if (!isAppError) {
    logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  } else if (statusCode >= 500) {
    logger.error({ err, requestId: req.requestId }, message);
  } else {
    logger.warn({ requestId: req.requestId, code }, message);
  }

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(isAppError && err.details ? { details: err.details } : {}),
    },
    requestId: req.requestId,
  };

  res.status(statusCode).json(body);
}
