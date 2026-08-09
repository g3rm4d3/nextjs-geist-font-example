import type { ApiSuccessResponse, HealthCheckResponse } from '@rideshare/types';
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
