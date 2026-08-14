import type { AdminRatingSummary } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminRatingService from '../services/adminRatingService';

export const adminRatingsRouter = Router();

/** Section 14's "Ratings" — every rating across every ride, both
 * directions, newest first. Read-only. */
adminRatingsRouter.get(
  '/admin/ratings',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const ratings: AdminRatingSummary[] = await adminRatingService.listRatings();
    sendSuccess(req, res, ratings);
  },
);
