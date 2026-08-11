export interface CreatePaymentIntentInput {
  /** Authoritative amount in integer cents — always computed server-side, never trusted from a client. */
  amountCents: number;
  currency: string;
  /**
   * Caller-supplied idempotency key. Passing the same key for a retried
   * create call must not create a second charge attempt at the provider.
   */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export type PaymentIntentStatus = 'requires_confirmation' | 'succeeded' | 'failed';

export interface PaymentIntentResult {
  /** Provider-safe opaque reference (e.g. Stripe's `pi_...` id). Never raw card data. */
  providerPaymentIntentId: string;
  status: PaymentIntentStatus;
}

export type PaymentConfirmationStatus = 'succeeded' | 'failed';

export interface PaymentConfirmationResult {
  status: PaymentConfirmationStatus;
  failureReason?: string;
}

export interface RefundResult {
  status: 'refunded';
  /** Provider-safe opaque reference (e.g. Stripe's `re_...` id). */
  providerRefundId: string;
}

export type PaymentWebhookEventType = 'payment_intent.succeeded' | 'payment_intent.payment_failed';

export interface PaymentWebhookEvent {
  type: PaymentWebhookEventType;
  providerPaymentIntentId: string;
  failureReason?: string;
}

/**
 * Section 11's PaymentProvider abstraction — the same MOCK-plus-real-shape
 * pattern as @rideshare/maps's RouteProvider (Phase 3). Stage 1 ships a
 * deterministic MOCK provider so the full charge/confirm/webhook/refund
 * lifecycle is testable without any real Stripe credentials, and a real
 * Stripe TEST MODE provider that this environment cannot exercise beyond
 * signature verification (no network-callable secret key is provisioned
 * here — see docs/payments.md). Consumed server-side only (apps/api) so
 * no secret key is ever embedded in a mobile client bundle.
 *
 * Every implementation MUST store only provider-safe references
 * (opaque ids) — raw card information must never reach this interface,
 * let alone be persisted.
 */
export interface PaymentProvider {
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;

  /**
   * Confirms a previously created PaymentIntent using one of Stripe's
   * well-known TEST MODE payment method ids (see testPaymentMethods.ts).
   * This is a test-only confirmation path — Stage 1 never collects or
   * transmits real card details.
   */
  confirmPaymentIntent(
    providerPaymentIntentId: string,
    testPaymentMethodId: string,
  ): Promise<PaymentConfirmationResult>;

  refundPaymentIntent(providerPaymentIntentId: string, reason?: string): Promise<RefundResult>;

  /**
   * Verifies a webhook's signature and returns the normalized event it
   * carries. Throws if the signature does not match. Pure local
   * verification — no network call.
   */
  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    webhookSecret: string,
  ): PaymentWebhookEvent;
}
