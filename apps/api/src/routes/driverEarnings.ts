import type { DriverEarningsHistoryEntry, DriverEarningsSummary } from '@rideshare/types';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { earningsLimiter } from '../middleware/rateLimit';
import * as earningsService from '../services/earningsService';

export const driverEarningsRouter = Router();

/** Section 12: "Driver sees: Today / Week / Month." */
driverEarningsRouter.get(
  '/drivers/me/earnings/summary',
  requireAuth,
  requireRole('DRIVER'),
  earningsLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const summary: DriverEarningsSummary = await earningsService.getDriverEarningsSummary(
      req.auth.userId,
    );
    sendSuccess(req, res, summary);
  },
);

/** Section 12: "Driver sees: ... Ride history." */
driverEarningsRouter.get(
  '/drivers/me/earnings/history',
  requireAuth,
  requireRole('DRIVER'),
  earningsLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const history: DriverEarningsHistoryEntry[] = await earningsService.getDriverEarningsHistory(
      req.auth.userId,
    );
    sendSuccess(req, res, history);
  },
);
