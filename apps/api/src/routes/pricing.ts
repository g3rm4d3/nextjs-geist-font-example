import type { FareEstimate } from '@rideshare/types';
// The request shape (origin + destination coordinates) is identical to
// /routes/preview's — reusing routePreviewSchema rather than declaring a
// near-duplicate keeps them from silently drifting apart.
import { routePreviewSchema } from '@rideshare/validation';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth } from '../middleware/auth';
import { pricingEstimateLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { getFareEstimate } from '../services/pricingService';

export const pricingRouter = Router();

/**
 * Section 4/Phase 4: centralized server-side pricing. Takes raw
 * origin/destination — never a client-supplied distance/duration — and
 * recomputes the route itself via @rideshare/maps before pricing it, so
 * the fare is authoritative end to end. See pricingService.getFareEstimate.
 */
pricingRouter.post(
  '/pricing/estimate',
  requireAuth,
  pricingEstimateLimiter,
  validateBody(routePreviewSchema),
  async (req, res) => {
    const { origin, destination } = req.body;
    const estimate: FareEstimate = await getFareEstimate(origin, destination);
    sendSuccess(req, res, estimate);
  },
);
