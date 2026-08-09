import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Assigns every request a unique ID (or reuses an inbound one from a
 * trusted upstream proxy) so a single ride/request can be traced through
 * logs, audit records, and error responses.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inboundId = req.header(REQUEST_ID_HEADER);
  req.requestId = inboundId && inboundId.length > 0 ? inboundId : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}
