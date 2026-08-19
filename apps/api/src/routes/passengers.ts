import { updatePaymentMethodSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { paymentLimiter, profileLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { getMe } from '../services/authService';
import * as paymentService from '../services/paymentService';

export const passengersRouter = Router();

/**
 * Minimal role-scoped endpoint. Its purpose in Phase 2 is to prove
 * requireRole actually blocks non-passengers (see
 * src/authorization.test.ts) — full passenger profile management is a
 * later phase.
 */
passengersRouter.get(
  '/passengers/me',
  requireAuth,
  requireRole('PASSENGER'),
  profileLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const user = await getMe(req.auth.userId);
    sendSuccess(req, res, user);
  },
);

/**
 * Section 11: which of Stripe's TEST MODE payment method ids to charge
 * by default when a ride of this passenger's completes. Rejects any id
 * outside @rideshare/payments's documented catalog (paymentService) —
 * this never accepts real card details, only one of a fixed set of
 * well-known test tokens.
 */
passengersRouter.patch(
  '/passengers/me/payment-method',
  requireAuth,
  requireRole('PASSENGER'),
  paymentLimiter,
  validateBody(updatePaymentMethodSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    await paymentService.updateDefaultTestPaymentMethod(req.auth.userId, req.body.testPaymentMethodId);
    sendSuccess(req, res, { updated: true });
  },
);
