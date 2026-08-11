import { TEST_PAYMENT_METHODS } from '@rideshare/payments';
import type { TestPaymentMethodSummary } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimit';

export const paymentsRouter = Router();

/**
 * Section 11: the catalog of Stripe's documented TEST MODE payment
 * method ids, served so PaymentMethodsScreen doesn't hardcode a
 * duplicate copy of @rideshare/payments's TEST_PAYMENT_METHODS — that
 * package is server-only (it pulls in the real `stripe` SDK, never meant
 * to ship inside a mobile client bundle), so this thin read-only endpoint
 * is how the client learns the choices. Not role-gated to PASSENGER
 * specifically (mirrors /pricing/estimate) — this is reference data, not
 * an action on anyone's account.
 */
paymentsRouter.get('/payments/test-methods', requireAuth, paymentLimiter, (req, res) => {
  const methods: TestPaymentMethodSummary[] = TEST_PAYMENT_METHODS.map((method) => ({
    id: method.id,
    label: method.label,
    outcome: method.outcome,
    description: method.description,
  }));
  sendSuccess(req, res, methods);
});
