import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createMockPaymentProvider } from './mockPaymentProvider';

describe('createMockPaymentProvider', () => {
  it('creates a payment intent with a provider-safe reference id and no card data', async () => {
    const provider = createMockPaymentProvider();

    const result = await provider.createPaymentIntent({
      amountCents: 1250,
      currency: 'usd',
      idempotencyKey: 'idem-1',
    });

    expect(result.providerPaymentIntentId).toMatch(/^pi_mock_/);
    expect(result.status).toBe('requires_confirmation');
  });

  it('confirms successfully with the standard successful test payment method', async () => {
    const provider = createMockPaymentProvider();
    const { providerPaymentIntentId } = await provider.createPaymentIntent({
      amountCents: 1250,
      currency: 'usd',
      idempotencyKey: 'idem-2',
    });

    const confirmation = await provider.confirmPaymentIntent(providerPaymentIntentId, 'pm_card_visa');

    expect(confirmation.status).toBe('succeeded');
    expect(confirmation.failureReason).toBeUndefined();
  });

  it('fails confirmation with a declined test payment method and reports a reason', async () => {
    const provider = createMockPaymentProvider();
    const { providerPaymentIntentId } = await provider.createPaymentIntent({
      amountCents: 1250,
      currency: 'usd',
      idempotencyKey: 'idem-3',
    });

    const confirmation = await provider.confirmPaymentIntent(
      providerPaymentIntentId,
      'pm_card_chargeDeclinedInsufficientFunds',
    );

    expect(confirmation.status).toBe('failed');
    expect(confirmation.failureReason).toContain('insufficient funds');
  });

  it('fails confirmation for an unrecognized payment method id', async () => {
    const provider = createMockPaymentProvider();
    const { providerPaymentIntentId } = await provider.createPaymentIntent({
      amountCents: 1250,
      currency: 'usd',
      idempotencyKey: 'idem-4',
    });

    const confirmation = await provider.confirmPaymentIntent(providerPaymentIntentId, 'pm_card_unknown');

    expect(confirmation.status).toBe('failed');
    expect(confirmation.failureReason).toContain('Unrecognized test payment method');
  });

  it('refunds a payment intent with a provider-safe refund reference', async () => {
    const provider = createMockPaymentProvider();
    const { providerPaymentIntentId } = await provider.createPaymentIntent({
      amountCents: 1250,
      currency: 'usd',
      idempotencyKey: 'idem-5',
    });

    const refund = await provider.refundPaymentIntent(providerPaymentIntentId, 'requested by passenger');

    expect(refund.status).toBe('refunded');
    expect(refund.providerRefundId).toMatch(/^re_mock_/);
  });

  it('generates a distinct payment intent id per call', async () => {
    const provider = createMockPaymentProvider();
    const input = { amountCents: 500, currency: 'usd', idempotencyKey: 'idem-6' };

    const first = await provider.createPaymentIntent(input);
    const second = await provider.createPaymentIntent({ ...input, idempotencyKey: 'idem-7' });

    expect(first.providerPaymentIntentId).not.toBe(second.providerPaymentIntentId);
  });

  describe('verifyWebhookSignature', () => {
    // The mock provider delegates webhook verification to the real
    // `stripe` SDK's local HMAC verification (webhookVerification.ts) —
    // this is genuine signature verification, not a faked check, even
    // though the rest of this provider is fully in-memory. No network
    // call is made by any assertion below.
    const webhookSecret = 'whsec_test_secret_for_mock_provider_verification';

    it('accepts a validly-signed payment_intent.succeeded event', () => {
      const provider = createMockPaymentProvider();
      const payload = JSON.stringify({
        id: 'evt_1',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_123', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const event = provider.verifyWebhookSignature(payload, header, webhookSecret);

      expect(event.type).toBe('payment_intent.succeeded');
      expect(event.providerPaymentIntentId).toBe('pi_test_123');
    });

    it('extracts a failure reason for a payment_intent.payment_failed event', () => {
      const provider = createMockPaymentProvider();
      const payload = JSON.stringify({
        id: 'evt_2',
        object: 'event',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_456',
            object: 'payment_intent',
            last_payment_error: { message: 'Your card was declined.' },
          },
        },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const event = provider.verifyWebhookSignature(payload, header, webhookSecret);

      expect(event.type).toBe('payment_intent.payment_failed');
      expect(event.providerPaymentIntentId).toBe('pi_test_456');
      expect(event.failureReason).toBe('Your card was declined.');
    });

    it('rejects a payload signed with the wrong secret', () => {
      const provider = createMockPaymentProvider();
      const payload = JSON.stringify({
        id: 'evt_3',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_789', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong_secret' });

      expect(() => provider.verifyWebhookSignature(payload, header, webhookSecret)).toThrow();
    });

    it('rejects a tampered payload whose signature no longer matches', () => {
      const provider = createMockPaymentProvider();
      const payload = JSON.stringify({
        id: 'evt_4',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_original', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const tamperedPayload = payload.replace('pi_test_original', 'pi_test_tampered');

      expect(() => provider.verifyWebhookSignature(tamperedPayload, header, webhookSecret)).toThrow();
    });

    it('rejects an unsupported event type', () => {
      const provider = createMockPaymentProvider();
      const payload = JSON.stringify({
        id: 'evt_5',
        object: 'event',
        type: 'charge.dispute.created',
        data: { object: { id: 'pi_test_999', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      expect(() => provider.verifyWebhookSignature(payload, header, webhookSecret)).toThrow(
        /Unsupported Stripe webhook event type/,
      );
    });
  });
});
