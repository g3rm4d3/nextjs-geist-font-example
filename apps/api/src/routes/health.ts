import type { ApiSuccessResponse, HealthCheckResponse, ReadinessCheckResponse } from '@rideshare/types';
import { Router } from 'express';
import { checkDatabaseConnection } from '../db/pool';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  const database = await checkDatabaseConnection();

  const data: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database,
  };

  const body: ApiSuccessResponse<HealthCheckResponse> = {
    success: true,
    data,
    requestId: req.requestId,
  };

  // The process itself is healthy even if the database is temporarily
  // unreachable; callers should inspect data.database.connected for that.
  res.status(200).json(body);
});

/**
 * PHASE 22: readiness, deliberately separate from liveness (GET /health
 * above) — see ReadinessCheckResponse's own doc comment for why. Unlike
 * /health, this endpoint's HTTP status itself carries the signal (200 vs
 * 503), which is what orchestrators/load balancers actually act on;
 * body.status is the same fact restated for a human or log line reading
 * the response body directly.
 */
healthRouter.get('/ready', async (req, res) => {
  const database = await checkDatabaseConnection();
  const ready = database.connected;

  const data: ReadinessCheckResponse = {
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    database,
  };

  const body: ApiSuccessResponse<ReadinessCheckResponse> = {
    success: true,
    data,
    requestId: req.requestId,
  };

  res.status(ready ? 200 : 503).json(body);
});
