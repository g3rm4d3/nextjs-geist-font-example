import {
  createMockPaymentProvider,
  createStripePaymentProvider,
  type PaymentProvider,
} from '@rideshare/payments';
import { env } from '../config/env';

/**
 * Single shared PaymentProvider instance for the process. Selects the
 * real Stripe TEST MODE provider when STRIPE_SECRET_KEY is configured,
 * otherwise falls back to the MOCK provider — mirrors mapProvider.ts's
 * RouteProvider selection (Phase 3). This environment has no real (even
 * TEST MODE) Stripe secret key it can provision or verify (docs/payments.md),
 * so Stage 1 dev/test/CI always runs on the MOCK provider by default.
 * Swapping to a real provider later is a one-line env var change; nothing
 * that imports `paymentProvider` needs to change.
 */
export const paymentProvider: PaymentProvider = env.STRIPE_SECRET_KEY
  ? createStripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY })
  : createMockPaymentProvider();

/**
 * Shared secret Stripe signs webhook payloads with. Required to verify
 * `POST /webhooks/stripe` deliveries; left undefined means that route
 * rejects every delivery (see paymentService.handleStripeWebhookEvent) —
 * there is no insecure fallback that skips verification.
 */
export const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
