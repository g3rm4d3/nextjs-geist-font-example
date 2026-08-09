import type { RoutePreview } from '@rideshare/maps';
import { routePreviewSchema } from '@rideshare/validation';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { routeProvider } from '../lib/mapProvider';
import { requireAuth } from '../middleware/auth';
import { routePreviewLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';

export const routePreviewRouter = Router();

/**
 * Section 13/Phase 3: the backend is the only thing that ever talks to a
 * map/routing provider — mobile clients call this endpoint instead of
 * embedding a map API key in the app bundle. Authenticated (any role)
 * rather than passenger-only, since the driver app will want the same
 * capability later (Phase 5 navigation) without a second endpoint.
 */
routePreviewRouter.post(
  '/routes/preview',
  requireAuth,
  routePreviewLimiter,
  validateBody(routePreviewSchema),
  async (req, res) => {
    const { origin, destination } = req.body;
    const preview: RoutePreview = await routeProvider.getRoute(origin, destination);
    sendSuccess(req, res, preview);
  },
);
