import type { DriverProfileSummary, Vehicle } from '@rideshare/types';
import { updateAvailabilitySchema, upsertVehicleSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { getMe } from '../services/authService';
import * as driverService from '../services/driverService';

export const driversRouter = Router();

/**
 * Minimal role-scoped endpoint proving requireRole blocks non-drivers
 * (see src/authorization.test.ts). The returned user includes
 * driverOnboardingStatus (section 8/9 — a driver can check their
 * application status even before being APPROVED).
 */
driversRouter.get('/drivers/me', requireAuth, requireRole('DRIVER'), async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const user = await getMe(req.auth.userId);
  sendSuccess(req, res, user);
});

/**
 * Section 4/Phase 5: the driver-app's onboarding/availability/vehicle
 * screens need more than AuthUser carries (a full vehicle, not just an
 * onboarding status string) — this is that dedicated read model.
 */
driversRouter.get('/drivers/me/profile', requireAuth, requireRole('DRIVER'), async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const profile: DriverProfileSummary = await driverService.getDriverProfileSummary(req.auth.userId);
  sendSuccess(req, res, profile);
});

/**
 * Upsert rather than create: a driver has at most one active vehicle
 * (see driversRepository.upsertVehicleForDriver), and the Vehicle screen
 * is a single form, not a list — editing re-submits the same shape.
 */
driversRouter.put(
  '/drivers/me/vehicle',
  requireAuth,
  requireRole('DRIVER'),
  validateBody(upsertVehicleSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const vehicle: Vehicle = await driverService.upsertVehicle(req.auth.userId, req.body);
    sendSuccess(req, res, vehicle);
  },
);

/**
 * DRAFT -> PENDING_REVIEW. The subsequent APPROVED/REJECTED decision is
 * an admin action (Phase 14) — this endpoint only ends the driver's side
 * of onboarding, it never grants approval itself.
 */
driversRouter.post(
  '/drivers/me/submit-application',
  requireAuth,
  requireRole('DRIVER'),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile: DriverProfileSummary = await driverService.submitApplication(req.auth.userId);
    sendSuccess(req, res, profile);
  },
);

/**
 * Section 9/Phase 5's core requirement: approved drivers can go
 * OFFLINE -> ONLINE; non-approved drivers cannot. See
 * driverService.setAvailability for the approval gate (also enforced at
 * the database level by driver_profiles_availability_requires_approval_chk
 * — this is the friendly error in front of that constraint, not a
 * replacement for it).
 */
driversRouter.patch(
  '/drivers/me/availability',
  requireAuth,
  requireRole('DRIVER'),
  validateBody(updateAvailabilitySchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile: DriverProfileSummary = await driverService.setAvailability(
      req.auth.userId,
      req.body,
    );
    sendSuccess(req, res, profile);
  },
);
