import Stripe from 'stripe';
import type { PaymentWebhookEvent, PaymentWebhookEventType } from './types';

/**
 * A syntactically-valid placeholder secret key used ONLY to construct a
 * Stripe SDK client for access to `.webhooks.constructEvent`. Signature
 * verification is pure local HMAC-SHA256 over (payload + header) using
 * the webhook secret argument — it never makes a network call and never
 * validates this key against Stripe's servers. This lets the MOCK
 * provider perform genuine (not reimplemented) signature verification
 * without requiring a real Stripe secret key to be configured.
 */
const PLACEHOLDER_API_KEY = 'sk_test_placeholder_no_network_call_is_made_for_webhook_verification';

const RECOGNIZED_EVENT_TYPES: readonly PaymentWebhookEventType[] = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

function isRecognizedEventType(type: string): type is PaymentWebhookEventType {
  return (RECOGNIZED_EVENT_TYPES as readonly string[]).includes(type);
}

let sharedClient: Stripe | undefined;

/**
 * A single lazily-created Stripe client used only for local webhook
 * signature verification (see PLACEHOLDER_API_KEY above). Shared across
 * calls rather than constructed per-call to avoid repeated SDK init cost.
 */
function getWebhookVerificationClient(): Stripe {
  sharedClient ??= new Stripe(PLACEHOLDER_API_KEY);
  return sharedClient;
}

/**
 * Verifies a Stripe webhook's signature and normalizes the event it
 * carries into this package's PaymentWebhookEvent shape. Shared by both
 * the MOCK and real Stripe providers so signature verification is
 * genuinely exercised (not faked) regardless of which provider is
 * active. Throws if the signature is missing, malformed, or does not
 * match the payload.
 */
export function verifyStripeWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  webhookSecret: string,
): PaymentWebhookEvent {
  const client = getWebhookVerificationClient();
  const event = client.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);

  if (!isRecognizedEventType(event.type)) {
    throw new Error(`Unsupported Stripe webhook event type: ${event.type}`);
  }

  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const failureReason =
    event.type === 'payment_intent.payment_failed'
      ? (paymentIntent.last_payment_error?.message ?? 'Payment failed.')
      : undefined;

  return {
    type: event.type,
    providerPaymentIntentId: paymentIntent.id,
    ...(failureReason !== undefined ? { failureReason } : {}),
  };
}
