import type { AdminRideDetail, AdminRideSummary } from '@rideshare/types';
import { Router } from 'express';
import { ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminRideService from '../services/adminRideService';

export const adminRidesRouter = Router();

const RIDE_STATUS_VALUES = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'PASSENGER_ONBOARD',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
];

/**
 * Section 14's "Rides" — every ride regardless of status, most recent
 * 100 first. Distinct from Phase 10's `GET /admin/rides/active` (which
 * stays exactly as it was — a focused non-terminal-only view for live
 * operations); this is the full browsable history.
 */
adminRidesRouter.get(
  '/admin/rides',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const statusParam = req.query.status;
    if (statusParam !== undefined) {
      if (typeof statusParam !== 'string' || !RIDE_STATUS_VALUES.includes(statusParam)) {
        throw new ValidationError('Invalid status filter');
      }
    }
    const rides: AdminRideSummary[] = await adminRideService.listRides(
      statusParam as AdminRideSummary['status'] | undefined,
    );
    sendSuccess(req, res, rides);
  },
);

/** "Inspect ride." */
adminRidesRouter.get(
  '/admin/rides/:id',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const rideId = requireIdParam(req.params.id, 'ride id');
    const detail: AdminRideDetail = await adminRideService.getRideDetail(rideId);
    sendSuccess(req, res, detail);
  },
);
