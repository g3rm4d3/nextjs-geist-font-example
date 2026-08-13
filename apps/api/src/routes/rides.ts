import type { AssignedRideDriverInfo, Payment, Rating, Ride, RideRatings } from '@rideshare/types';
import { cancelRideSchema, createRideRequestSchema, submitRatingSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  paymentLimiter,
  ratingLimiter,
  rideLifecycleLimiter,
  rideRequestLimiter,
} from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as paymentService from '../services/paymentService';
import * as ratingsService from '../services/ratingsService';
import * as rideLifecycleService from '../services/rideLifecycleService';
import * as rideService from '../services/rideService';
import * as rideTrackingService from '../services/rideTrackingService';

export const ridesRouter = Router();

/**
 * Section 7: "Passenger can submit ride request." See rideService for
 * where every one of the spec's validations (pickup, destination,
 * route, estimate, passenger eligibility, active ride status) actually
 * happens, and for the idempotency-key + one-active-ride-per-passenger
 * mechanics that prevent a double-tap from creating two rides.
 *
 * 201 for a newly created ride, 200 when this call resolved to an
 * existing one (an idempotent replay, or the losing side of a race that
 * got redirected to the winner) — the response body is the same Ride
 * shape either way.
 */
ridesRouter.post(
  '/rides',
  requireAuth,
  requireRole('PASSENGER'),
  rideRequestLimiter,
  validateBody(createRideRequestSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const result = await rideService.requestRide(req.auth.userId, req.body);
    const ride: Ride = result.ride;
    sendSuccess(req, res, ride, result.created ? 201 : 200);
  },
);

/**
 * Phase 9: a passenger reading back their own ride's current state —
 * used for polling status while `SEARCHING_DRIVER`/en route/etc. Drivers
 * use the equivalent endpoint under /drivers/me/rides/:id (driverRides.ts);
 * this one is passenger-only and 404s for a ride that isn't the caller's,
 * same not-found-not-forbidden treatment as everywhere else in this phase.
 */
ridesRouter.get(
  '/rides/:id',
  requireAuth,
  requireRole('PASSENGER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.getRideForUser(
      rideId,
      req.auth.userId,
      'PASSENGER',
    );
    sendSuccess(req, res, ride);
  },
);

/**
 * Section 10: "display assigned driver ... driver location, estimated
 * arrival." `null` data (200, not 404) is the normal "nothing to show
 * yet/anymore" case — see rideTrackingService.getAssignedDriverInfo.
 */
ridesRouter.get(
  '/rides/:id/driver',
  requireAuth,
  requireRole('PASSENGER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const info: AssignedRideDriverInfo | null = await rideTrackingService.getAssignedDriverInfo(
      rideId,
      req.auth.userId,
    );
    sendSuccess(req, res, info);
  },
);

/**
 * Section 9's one passenger-facing state-changing action: cancel. Only
 * legal up through DRIVER_ARRIVED (see rideLifecycleService's
 * CANCELLABLE_STATUSES) — a passenger cannot cancel once they're
 * actually onboard, which is exactly "passenger cannot arbitrarily
 * modify state" made concrete: there is no other endpoint here that
 * takes a status from the client at all.
 */
ridesRouter.post(
  '/rides/:id/cancel',
  requireAuth,
  requireRole('PASSENGER'),
  rideLifecycleLimiter,
  validateBody(cancelRideSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.cancelRideByPassenger(
      rideId,
      req.auth.userId,
      req.body.reason,
    );
    sendSuccess(req, res, ride);
  },
);

/**
 * Section 11: read the current (latest) payment attempt for a ride.
 * Charging itself is auto-triggered server-side on ride completion (see
 * rideLifecycleService.completeRide) — there is no client-initiated
 * "pay" action, only this read and the retry endpoint below.
 */
ridesRouter.get(
  '/rides/:id/payment',
  requireAuth,
  requireRole('PASSENGER'),
  paymentLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const payment: Payment = await paymentService.getPaymentForRide(rideId, req.auth.userId);
    sendSuccess(req, res, payment);
  },
);

/**
 * Section 11: passenger-initiated retry after a FAILED payment attempt.
 * paymentService.retryRidePayment enforces that only the ride's own
 * passenger can retry, only for a COMPLETED ride, and only when the most
 * recent attempt actually FAILED (never re-charging a SUCCEEDED payment
 * or racing a PENDING one).
 */
ridesRouter.post(
  '/rides/:id/payment/retry',
  requireAuth,
  requireRole('PASSENGER'),
  paymentLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const payment: Payment = await paymentService.retryRidePayment(rideId, req.auth.userId);
    sendSuccess(req, res, payment);
  },
);

/**
 * Section 13: "Passenger rates Driver." 1-5 stars, optional comment —
 * ratingsService enforces "ratings unavailable before ride completion"
 * and "one rating per direction per completed ride" (409 for either
 * violation), and recomputes the driver's aggregate rating server-side.
 */
ridesRouter.post(
  '/rides/:id/rating',
  requireAuth,
  requireRole('PASSENGER'),
  ratingLimiter,
  validateBody(submitRatingSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const rating: Rating = await ratingsService.submitPassengerToDriverRating(
      rideId,
      req.auth.userId,
      req.body,
    );
    sendSuccess(req, res, rating, 201);
  },
);

/** Section 13: both directions' ratings for a ride the caller (as
 * passenger) is part of — lets the passenger see their own submitted
 * rating and whether the driver has rated them back. */
ridesRouter.get(
  '/rides/:id/ratings',
  requireAuth,
  requireRole('PASSENGER'),
  ratingLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ratings: RideRatings = await ratingsService.getRatingsForRide(
      rideId,
      req.auth.userId,
      'PASSENGER',
    );
    sendSuccess(req, res, ratings);
  },
);
