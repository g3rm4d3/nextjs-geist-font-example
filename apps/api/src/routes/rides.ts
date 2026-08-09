import type { Ride } from '@rideshare/types';
import { createRideRequestSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { rideRequestLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as rideService from '../services/rideService';

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
