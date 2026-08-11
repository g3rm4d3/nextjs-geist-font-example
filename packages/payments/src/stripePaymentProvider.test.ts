import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripePaymentProvider } from './stripePaymentProvider';

describe('createStripePaymentProvider', () => {
  // "NO LIVE TRANSACTIONS" is enforced in code: construction must reject
  // any secret key that isn't a TEST MODE key, so a live key can never
  // even produce a usable provider instance. No network call happens in
  // any of these — they only exercise the constructor guard.
  it('throws when constructed with a live secret key', () => {
    expect(() => createStripePaymentProvider({ secretKey: 'sk_live_should_never_be_accepted' })).toThrow(
      /TEST MODE/,
    );
  });

  it('throws when constructed with a key missing the sk_test_ prefix entirely', () => {
    expect(() => createStripePaymentProvider({ secretKey: 'not-a-stripe-key' })).toThrow(/TEST MODE/);
  });

  it('constructs successfully with a TEST MODE secret key', () => {
    expect(() => createStripePaymentProvider({ secretKey: 'sk_test_example_key' })).not.toThrow();
  });

  describe('verifyWebhookSignature', () => {
    // Genuine, non-mocked local HMAC verification — no network call.
    const webhookSecret = 'whsec_test_secret_for_real_provider_verification';

    it('accepts a validly-signed event', () => {
      const provider = createStripePaymentProvider({ secretKey: 'sk_test_example_key' });
      const payload = JSON.stringify({
        id: 'evt_1',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_abc', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const event = provider.verifyWebhookSignature(payload, header, webhookSecret);

      expect(event.type).toBe('payment_intent.succeeded');
      expect(event.providerPaymentIntentId).toBe('pi_test_abc');
    });

    it('rejects an incorrectly-signed event', () => {
      const provider = createStripePaymentProvider({ secretKey: 'sk_test_example_key' });
      const payload = JSON.stringify({
        id: 'evt_2',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_def', object: 'payment_intent' } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });

      expect(() => provider.verifyWebhookSignature(payload, header, webhookSecret)).toThrow();
    });
  });
});
