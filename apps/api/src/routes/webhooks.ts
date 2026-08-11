import express, { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { stripeWebhookLimiter } from '../middleware/rateLimit';
import * as paymentService from '../services/paymentService';

export const webhooksRouter = Router();

/**
 * Section 11: webhook handling + signature verification. Mounted in
 * app.ts BEFORE the global `express.json()` body parser — Stripe signs
 * the exact raw request body bytes, so this route needs `express.raw()`
 * applied to it specifically; the already-parsed-then-re-serialized JSON
 * every other route gets would not byte-for-byte match what was signed,
 * making verification fail for every legitimate delivery.
 *
 * No requireAuth here — the caller is Stripe, not a signed-in user.
 * paymentService.handleStripeWebhookEvent's signature check is what
 * actually authenticates the request; an invalid or missing signature is
 * rejected there (403), never trusted.
 */
webhooksRouter.post(
  '/webhooks/stripe',
  stripeWebhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.header('stripe-signature');
    await paymentService.handleStripeWebhookEvent(req.body as Buffer, signature);
    sendSuccess(req, res, { received: true });
  },
);
