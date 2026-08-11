import Stripe from 'stripe';
import type {
  CreatePaymentIntentInput,
  PaymentConfirmationResult,
  PaymentIntentResult,
  PaymentIntentStatus,
  PaymentProvider,
  RefundResult,
} from './types';
import { verifyStripeWebhookSignature } from './webhookVerification';

export interface StripePaymentProviderOptions {
  secretKey: string;
}

const TEST_MODE_KEY_PREFIX = 'sk_test_';

function toPaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentIntentStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'canceled') return 'failed';
  return 'requires_confirmation';
}

/**
 * Real Stripe TEST MODE PaymentProvider. Hard-enforces the spec's "NO
 * LIVE TRANSACTIONS" requirement in code, not just policy: construction
 * throws immediately if `secretKey` is not a TEST MODE key (`sk_test_`
 * prefix) — a live secret key can never be used to construct this
 * provider, so a misconfigured environment fails loudly at startup
 * rather than silently risking a real charge.
 *
 * This environment has no real (even TEST MODE) Stripe secret key it can
 * provision or verify, so PaymentIntent create/confirm/refund calls here
 * cannot be exercised end-to-end in this sandbox — see docs/payments.md,
 * mirroring the same documented limitation as @rideshare/maps's real
 * routing provider (docs/maps.md). Webhook signature verification is the
 * one operation that needs no network call, so it is fully, genuinely
 * tested regardless (see webhookVerification.ts).
 */
export function createStripePaymentProvider(options: StripePaymentProviderOptions): PaymentProvider {
  if (!options.secretKey.startsWith(TEST_MODE_KEY_PREFIX)) {
    throw new Error(
      `Refusing to construct a Stripe payment provider with a non-TEST-MODE secret key. ` +
        `Stage 1 permits Stripe TEST MODE only (keys must start with "${TEST_MODE_KEY_PREFIX}") — NO LIVE TRANSACTIONS.`,
    );
  }

  const stripe = new Stripe(options.secretKey);

  return {
    async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency,
          confirm: false,
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );

      return {
        providerPaymentIntentId: paymentIntent.id,
        status: toPaymentIntentStatus(paymentIntent.status),
      };
    },

    async confirmPaymentIntent(
      providerPaymentIntentId: string,
      testPaymentMethodId: string,
    ): Promise<PaymentConfirmationResult> {
      try {
        const paymentIntent = await stripe.paymentIntents.confirm(providerPaymentIntentId, {
          payment_method: testPaymentMethodId,
        });

        if (paymentIntent.status === 'succeeded') {
          return { status: 'succeeded' };
        }

        return {
          status: 'failed',
          failureReason: paymentIntent.last_payment_error?.message ?? `Unexpected status: ${paymentIntent.status}`,
        };
      } catch (error) {
        const failureReason =
          error instanceof Stripe.errors.StripeError ? error.message : 'Payment confirmation failed.';
        return { status: 'failed', failureReason };
      }
    },

    async refundPaymentIntent(providerPaymentIntentId: string, reason?: string): Promise<RefundResult> {
      // Stripe's `reason` field is a closed enum (duplicate / fraudulent /
      // requested_by_customer), not free text, so our free-text reason is
      // recorded in metadata instead rather than force-fit into it.
      const refund = await stripe.refunds.create({
        payment_intent: providerPaymentIntentId,
        metadata: reason ? { internal_reason: reason } : undefined,
      });
      return { status: 'refunded', providerRefundId: refund.id };
    },

    verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
      return verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret);
    },
  };
}
