import type { Rating, Ride, RideRatings } from '@rideshare/types';
import { cancelRideSchema, submitRatingSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { ratingLimiter, rideLifecycleLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as ratingsService from '../services/ratingsService';
import * as rideLifecycleService from '../services/rideLifecycleService';

export const driverRidesRouter = Router();

/**
 * Section 9's strict driver-driven forward lifecycle, one endpoint per
 * transition:
 *
 *   DRIVER_ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED
 *     -> PASSENGER_ONBOARD -> IN_PROGRESS -> COMPLETED
 *
 * Every handler here is deliberately thin — the actual atomicity,
 * ownership check ("driver cannot operate another driver's ride"), and
 * state-precondition enforcement ("driver cannot complete a ride that
 * never started") all live in rideLifecycleService, exercised by the
 * exact same code path every one of these six actions goes through.
 */
driverRidesRouter.post(
  '/drivers/me/rides/:id/en-route',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.markEnRoute(rideId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

driverRidesRouter.post(
  '/drivers/me/rides/:id/arrived',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.markArrived(rideId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

driverRidesRouter.post(
  '/drivers/me/rides/:id/picked-up',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.markPassengerOnboard(rideId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

driverRidesRouter.post(
  '/drivers/me/rides/:id/start',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.startTrip(rideId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

/** "Driver cannot complete ride that never started" — see
 * rideLifecycleService.completeRide's own doc comment for exactly how
 * that's enforced. Also computes and stores the ride's final fare. */
driverRidesRouter.post(
  '/drivers/me/rides/:id/complete',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.completeRide(rideId, req.auth.userId);
    sendSuccess(req, res, ride);
  },
);

/** Driver-side cancel — same allowed-status window as the passenger's
 * (rideLifecycleService.CANCELLABLE_STATUSES), and frees the driver back
 * to ONLINE in the same transaction as the cancellation itself. */
driverRidesRouter.post(
  '/drivers/me/rides/:id/cancel',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  validateBody(cancelRideSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.cancelRideByDriver(
      rideId,
      req.auth.userId,
      req.body.reason,
    );
    sendSuccess(req, res, ride);
  },
);

/**
 * Phase 9: a driver reading back the current state of a ride they're
 * assigned to — used for polling from PickupNavigation/Ride/Arrival
 * screens. 404s for any ride that isn't theirs.
 */
driverRidesRouter.get(
  '/drivers/me/rides/:id',
  requireAuth,
  requireRole('DRIVER'),
  rideLifecycleLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ride: Ride = await rideLifecycleService.getRideForUser(rideId, req.auth.userId, 'DRIVER');
    sendSuccess(req, res, ride);
  },
);

/**
 * Section 13: "Driver rates Passenger." Mirrors POST /rides/:id/rating
 * exactly — see ratingsService.submitDriverToPassengerRating for the
 * same COMPLETED-only / one-per-direction enforcement and aggregate
 * recomputation, applied to the passenger's profile instead.
 */
driverRidesRouter.post(
  '/drivers/me/rides/:id/rating',
  requireAuth,
  requireRole('DRIVER'),
  ratingLimiter,
  validateBody(submitRatingSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const rating: Rating = await ratingsService.submitDriverToPassengerRating(
      rideId,
      req.auth.userId,
      req.body,
    );
    sendSuccess(req, res, rating, 201);
  },
);

/** Section 13: both directions' ratings for a ride the caller (as
 * driver) is part of. */
driverRidesRouter.get(
  '/drivers/me/rides/:id/ratings',
  requireAuth,
  requireRole('DRIVER'),
  ratingLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const rideId = requireIdParam(req.params.id, 'ride id');
    const ratings: RideRatings = await ratingsService.getRatingsForRide(
      rideId,
      req.auth.userId,
      'DRIVER',
    );
    sendSuccess(req, res, ratings);
  },
);
