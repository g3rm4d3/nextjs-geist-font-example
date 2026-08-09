import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { getMe } from '../services/authService';

export const passengersRouter = Router();

/**
 * Minimal role-scoped endpoint. Its purpose in Phase 2 is to prove
 * requireRole actually blocks non-passengers (see
 * src/authorization.test.ts) — full passenger profile management is a
 * later phase.
 */
passengersRouter.get('/passengers/me', requireAuth, requireRole('PASSENGER'), async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const user = await getMe(req.auth.userId);
  sendSuccess(req, res, user);
});
