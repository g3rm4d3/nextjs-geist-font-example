import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { getMe } from '../services/authService';

export const driversRouter = Router();

/**
 * Minimal role-scoped endpoint proving requireRole blocks non-drivers
 * (see src/authorization.test.ts). The returned user includes
 * driverOnboardingStatus (section 8/9 — a driver can check their
 * application status even before being APPROVED). Full driver profile
 * management is a later phase.
 */
driversRouter.get('/drivers/me', requireAuth, requireRole('DRIVER'), async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const user = await getMe(req.auth.userId);
  sendSuccess(req, res, user);
});
