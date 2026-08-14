import type { AdminDriverEarningsRow } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminEarningsService from '../services/adminEarningsService';

export const adminEarningsRouter = Router();

/**
 * Section 14's "Earnings" per-driver breakdown. Platform-wide
 * Today/Week/Month/All-time totals already exist at GET /admin/revenue
 * (Phase 12, routes/admin.ts) — this is the drill-down that docs on that
 * phase deferred here.
 */
adminEarningsRouter.get(
  '/admin/earnings/by-driver',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const rows: AdminDriverEarningsRow[] = await adminEarningsService.listDriverEarningsForAdmin();
    sendSuccess(req, res, rows);
  },
);
