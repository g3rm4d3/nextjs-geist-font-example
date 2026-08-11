import { randomUUID } from 'node:crypto';
import { findTestPaymentMethod } from './testPaymentMethods';
import type {
  CreatePaymentIntentInput,
  PaymentConfirmationResult,
  PaymentIntentResult,
  PaymentProvider,
  RefundResult,
} from './types';
import { verifyStripeWebhookSignature } from './webhookVerification';

/**
 * MOCK / dev-only PaymentProvider — see createHaversineRouteProvider in
 * @rideshare/maps for the same pattern applied elsewhere. Deterministic
 * and fully in-memory: no network call is ever made, so it runs in any
 * environment (including this one) without a real Stripe secret key.
 *
 * Confirmation outcomes are driven entirely by which of Stripe's
 * documented TEST MODE payment method ids (see testPaymentMethods.ts) is
 * passed in — the same ids and the same outcomes the real Stripe TEST
 * MODE provider would give, so swapping providers changes nothing about
 * caller expectations.
 *
 * Webhook signature verification is NOT reimplemented here — it
 * delegates to the real `stripe` SDK's local HMAC verification (see
 * webhookVerification.ts), so this is genuine signature verification,
 * not a faked check.
 */
export function createMockPaymentProvider(): PaymentProvider {
  return {
    // Async to match PaymentProvider's interface, which the real
    // network-backed Stripe provider needs — even though this one never
    // actually awaits.
    async createPaymentIntent(_input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
      return {
        providerPaymentIntentId: `pi_mock_${randomUUID()}`,
        status: 'requires_confirmation',
      };
    },

    async confirmPaymentIntent(
      providerPaymentIntentId: string,
      testPaymentMethodId: string,
    ): Promise<PaymentConfirmationResult> {
      const method = findTestPaymentMethod(testPaymentMethodId);

      if (!method) {
        return {
          status: 'failed',
          failureReason: `Unrecognized test payment method: ${testPaymentMethodId}`,
        };
      }

      if (method.outcome === 'fails') {
        return { status: 'failed', failureReason: method.description };
      }

      return { status: 'succeeded' };
    },

    async refundPaymentIntent(_providerPaymentIntentId: string, _reason?: string): Promise<RefundResult> {
      return { status: 'refunded', providerRefundId: `re_mock_${randomUUID()}` };
    },

    verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
      return verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret);
    },
  };
}
