import type { AdminDashboardSummary } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminDashboardService from '../services/adminDashboardService';

export const adminDashboardRouter = Router();

/** Section 14's "Dashboard" — the admin-app landing page. */
adminDashboardRouter.get(
  '/admin/dashboard',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const summary: AdminDashboardSummary = await adminDashboardService.getDashboardSummary();
    sendSuccess(req, res, summary);
  },
);
