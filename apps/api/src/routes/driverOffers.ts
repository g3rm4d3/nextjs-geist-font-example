import type { Ride, RideOffer } from '@rideshare/types';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { driverOfferLimiter } from '../middleware/rateLimit';
import * as matchingService from '../services/matchingService';

export const driverOffersRouter = Router();

/**
 * Section 8's offer flow, from the driver's side: a driver-app poll loop
 * calls this to find out whether it currently has an offer to show. `null`
 * data (200, not 404) is the normal "nothing right now" case — see
 * matchingService.getCurrentOffer.
 */
driverOffersRouter.get(
  '/drivers/me/offer',
  requireAuth,
  requireRole('DRIVER'),
  driverOfferLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const offer: RideOffer | null = await matchingService.getCurrentOffer(req.auth.userId);
    sendSuccess(req, res, offer);
  },
);

/**
 * ACCEPT. See matchingService.handleAccept for the atomic
 * compare-and-swap transaction that guarantees exactly one driver wins
 * when several accept concurrently — this handler is deliberately thin,
 * every guarantee lives there. `:id` is the ride_request id (RideOffer.id
 * from GET .../offer), not the ride's own id.
 */
driverOffersRouter.post(
  '/drivers/me/offer/:id/accept',
  requireAuth,
  requireRole('DRIVER'),
  driverOfferLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideRequestId = requireIdParam(req.params.id);
    const ride: Ride = await matchingService.handleAccept(rideRequestId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

/**
 * DECLINE. Always advances matching to the next candidate for the ride
 * (matchingService.handleDecline) — nothing further for the declining
 * driver to see, hence the empty success body.
 */
driverOffersRouter.post(
  '/drivers/me/offer/:id/decline',
  requireAuth,
  requireRole('DRIVER'),
  driverOfferLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideRequestId = requireIdParam(req.params.id);
    await matchingService.handleDecline(rideRequestId, req.auth.userId);
    sendSuccess(req, res, { declined: true });
  },
);
