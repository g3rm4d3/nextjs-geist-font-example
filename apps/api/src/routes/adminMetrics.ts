import type { RouteMetricSummary } from '@rideshare/observability';
import { Router } from 'express';
import { metricsRecorder } from '../lib/metrics';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';

export const adminMetricsRouter = Router();

/**
 * Phase 22's "performance metrics" surface — any admin can view, same
 * access level as GET /admin/settings (read-only operational visibility,
 * not a moderation action). See @rideshare/observability's own doc
 * comment for what this is (and isn't): an in-process, since-last-
 * restart aggregate, not a full metrics backend.
 */
adminMetricsRouter.get(
  '/admin/metrics',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  (req, res) => {
    const routes: RouteMetricSummary[] = metricsRecorder.summarize();
    sendSuccess(req, res, { routes });
  },
);
