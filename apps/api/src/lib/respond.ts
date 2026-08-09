import type { ApiSuccessResponse } from '@rideshare/types';
import type { Request, Response } from 'express';

/** Shared envelope for every 2xx JSON response — see routes/health.ts for the original pattern. */
export function sendSuccess<T>(req: Request, res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    requestId: req.requestId,
  };
  res.status(statusCode).json(body);
}
