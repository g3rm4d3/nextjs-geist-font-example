import type { AdminDriverDetail, AdminDriverSummary } from '@rideshare/types';
import { rejectDriverSchema, suspendDriverSchema } from '@rideshare/validation';
import type { Request } from 'express';
import { Router } from 'express';
import type { AuditActorContext } from '../lib/auditContext';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminDriverService from '../services/adminDriverService';

export const adminDriversRouter = Router();

const ONBOARDING_STATUS_VALUES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];

/** Every mutating admin route builds this the same way — pulled into
 * one helper so `actor.userId`/`actor.role` always come from the
 * server-verified JWT (`req.auth`), never anything client-supplied. */
function actorFrom(req: Request): AuditActorContext {
  if (!req.auth) throw new UnauthorizedError();
  return {
    userId: req.auth.userId,
    role: req.auth.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
  };
}

/**
 * Section 14: "Drivers." `?onboardingStatus=PENDING_REVIEW` is also how
 * the "Driver Applications" section is served — the same list, filtered,
 * not a second endpoint.
 */
adminDriversRouter.get(
  '/admin/drivers',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const statusParam = req.query.onboardingStatus;
    if (statusParam !== undefined) {
      if (typeof statusParam !== 'string' || !ONBOARDING_STATUS_VALUES.includes(statusParam)) {
        throw new ValidationError('Invalid onboardingStatus filter');
      }
    }
    const drivers: AdminDriverSummary[] = await adminDriverService.listDrivers(
      statusParam as AdminDriverSummary['onboardingStatus'] | undefined,
    );
    sendSuccess(req, res, drivers);
  },
);

/** "Inspect driver": full profile, current vehicle, and every document. */
adminDriversRouter.get(
  '/admin/drivers/:id',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const driverId = requireIdParam(req.params.id, 'driver id');
    const detail: AdminDriverDetail = await adminDriverService.getDriverDetail(driverId);
    sendSuccess(req, res, detail);
  },
);

/** "Approve driver" — PENDING_REVIEW -> APPROVED. Available to any
 * admin (routine onboarding moderation), audited. */
adminDriversRouter.post(
  '/admin/drivers/:id/approve',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const driverId = requireIdParam(req.params.id, 'driver id');
    const driver: AdminDriverSummary = await adminDriverService.approveDriver(driverId, actorFrom(req));
    sendSuccess(req, res, driver);
  },
);

/** "Reject driver" — PENDING_REVIEW -> REJECTED, reason required. */
adminDriversRouter.post(
  '/admin/drivers/:id/reject',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  validateBody(rejectDriverSchema),
  async (req, res) => {
    const driverId = requireIdParam(req.params.id, 'driver id');
    const driver: AdminDriverSummary = await adminDriverService.rejectDriver(
      driverId,
      actorFrom(req),
      req.body.reason,
    );
    sendSuccess(req, res, driver);
  },
);

/**
 * "Suspend driver" — SUPER_ADMIN only. Unlike approve/reject (routine,
 * expected onboarding decisions), suspending an already-APPROVED driver
 * pulls them out of service mid-career — see
 * docs/admin-application.md for why this is one of the actions where
 * SUPER_ADMIN is distinguished from ADMIN.
 */
adminDriversRouter.post(
  '/admin/drivers/:id/suspend',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  adminLimiter,
  validateBody(suspendDriverSchema),
  async (req, res) => {
    const driverId = requireIdParam(req.params.id, 'driver id');
    const driver: AdminDriverSummary = await adminDriverService.suspendDriver(
      driverId,
      actorFrom(req),
      req.body.reason,
    );
    sendSuccess(req, res, driver);
  },
);

/** "Reactivate driver" — SUPER_ADMIN only, same reasoning as suspend. */
adminDriversRouter.post(
  '/admin/drivers/:id/reactivate',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const driverId = requireIdParam(req.params.id, 'driver id');
    const driver: AdminDriverSummary = await adminDriverService.reactivateDriver(driverId, actorFrom(req));
    sendSuccess(req, res, driver);
  },
);
