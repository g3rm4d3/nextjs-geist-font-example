import type { NextFunction, Request, Response } from 'express';
import { metricsRecorder } from '../lib/metrics';

/**
 * Records one sample per response into the shared in-memory
 * MetricsRecorder — the source for GET /admin/metrics. Mounted after
 * Express has matched a route (so `req.route` is populated) but this
 * still fires for a 404 (no matched route), falling back to `req.path`
 * so unmatched requests aren't silently dropped from the metrics either
 * — they just aggregate under the literal path instead of a pattern,
 * same trade-off `notFoundHandler`/`errorHandler` already accept for a
 * 404's log line.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    metricsRecorder.record({
      method: req.method,
      route,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
