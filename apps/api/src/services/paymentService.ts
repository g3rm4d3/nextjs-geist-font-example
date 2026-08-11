import { randomUUID } from 'node:crypto';
import { DEFAULT_TEST_PAYMENT_METHOD_ID, isKnownTestPaymentMethod, type PaymentWebhookEvent } from '@rideshare/payments';
import type { Payment } from '@rideshare/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import { paymentProvider, stripeWebhookSecret } from '../lib/paymentProvider';
import {
  createPaymentRecord,
  findLatestPaymentRecordForRide,
  findPaymentRecordById,
  findPaymentRecordByProviderPaymentIntentId,
  markPaymentOutcome,
  markPaymentOutcomeByProviderPaymentIntentId,
  markPaymentRefunded,
  setProviderPaymentIntentId,
  type PaymentRecordRow,
} from '../repositories/paymentsRepository';
import { findRideById } from '../repositories/ridesRepository';
import {
  findPassengerProfileById,
  findPassengerProfileByUserId,
  setPassengerDefaultTestPaymentMethod,
} from '../repositories/usersRepository';

function toPayment(row: PaymentRecordRow): Payment {
  return {
    id: row.id,
    rideId: row.rideId,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    failureReason: row.failureReason,
    refundedAt: row.refundedAt ? row.refundedAt.toISOString() : null,
    refundReason: row.refundReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Runs one payment attempt: creates a PaymentIntent for the given amount
 * (always server-computed — see chargeRideFare/retryRidePayment, never a
 * client-supplied value, section 3/11) and confirms it immediately with
 * the given test payment method. Stripe TEST MODE confirmation actually
 * resolves synchronously, so this updates the record directly with the
 * outcome; handleStripeWebhookEvent performs the exact same compare-and-
 * swap keyed by provider reference and is a no-op if this already won
 * the race — the two are redundant by design, the way a real async
 * Stripe integration would rely on the webhook as authoritative while
 * this optimistic path just makes the common case fast.
 */
async function runPaymentAttempt(
  rideId: string,
  amountCents: number,
  testPaymentMethodId: string,
  idempotencyKey: string,
): Promise<PaymentRecordRow> {
  const record = await createPaymentRecord({
    rideId,
    amountCents,
    currency: 'usd',
    idempotencyKey,
  });

  const intent = await paymentProvider.createPaymentIntent({
    amountCents,
    currency: 'usd',
    idempotencyKey,
    metadata: { rideId },
  });
  await setProviderPaymentIntentId(record.id, intent.providerPaymentIntentId);

  const confirmation = await paymentProvider.confirmPaymentIntent(
    intent.providerPaymentIntentId,
    testPaymentMethodId,
  );

  const updated = await markPaymentOutcome({
    paymentRecordId: record.id,
    toStatus: confirmation.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
    failureReason: confirmation.failureReason ?? null,
  });
  if (updated) return updated;

  // Lost the compare-and-swap to a racing webhook delivery for the same
  // intent — that outcome is authoritative now; re-read the current row.
  const current = await findPaymentRecordById(record.id);
  if (!current) throw new Error(`Payment record ${record.id} disappeared mid-attempt`);
  return current;
}

/**
 * Auto-triggered from rideLifecycleService.completeRide immediately
 * after a ride reaches COMPLETED, mirroring Phase 7/8's "matching
 * failure must not fail ride request" precedent: a payment-provider
 * hiccup must not fail ride completion itself. Callers wrap this in
 * try/catch — see rideLifecycleService.completeRide.
 *
 * The amount charged is always `ride.finalFareCents`, computed
 * server-side by pricingService when the ride was completed — there is
 * no path for a client to influence it (section 3's server-authoritative
 * principle, applied to payments per this phase's own spec line).
 */
export async function chargeRideFare(rideId: string): Promise<void> {
  const ride = await findRideById(rideId);
  if (!ride || ride.status !== 'COMPLETED' || ride.finalFareCents === null) {
    throw new Error(`Ride ${rideId} is not COMPLETED with a final fare; cannot charge`);
  }

  const existing = await findLatestPaymentRecordForRide(rideId);
  if (existing) {
    // completeRide should only ever trigger this once per ride, but
    // guard against a double-trigger rather than relying solely on
    // caller discipline — charging twice would violate "backend creates
    // authoritative payment amount", not just be a minor duplication.
    return;
  }

  const passenger = await findPassengerProfileById(ride.passengerId);
  const testPaymentMethodId = passenger?.defaultTestPaymentMethodId ?? DEFAULT_TEST_PAYMENT_METHOD_ID;

  await runPaymentAttempt(rideId, ride.finalFareCents, testPaymentMethodId, `ride-payment-${rideId}`);
}

/**
 * Passenger-facing retry after a FAILED attempt. A fresh attempt with a
 * fresh idempotency key — payment_records allows multiple rows per ride
 * (retries after a failed attempt); idempotencyKey is unique per
 * attempt, not per ride (see packages/database/src/schema/payments.ts).
 */
export async function retryRidePayment(rideId: string, userId: string): Promise<Payment> {
  const passenger = await findPassengerProfileByUserId(userId);
  if (!passenger) throw new Error('Passenger profile not found for authenticated passenger user');

  const ride = await findRideById(rideId);
  if (!ride || ride.passengerId !== passenger.id) {
    throw new NotFoundError('Ride not found');
  }
  if (ride.status !== 'COMPLETED' || ride.finalFareCents === null) {
    throw new ConflictError('This ride has no completed payment to retry');
  }

  const latest = await findLatestPaymentRecordForRide(rideId);
  if (!latest || latest.status !== 'FAILED') {
    throw new ConflictError(
      'The most recent payment attempt for this ride is not in a retryable state',
    );
  }

  const testPaymentMethodId = passenger.defaultTestPaymentMethodId ?? DEFAULT_TEST_PAYMENT_METHOD_ID;
  const record = await runPaymentAttempt(
    rideId,
    ride.finalFareCents,
    testPaymentMethodId,
    `ride-payment-${rideId}-retry-${randomUUID()}`,
  );
  return toPayment(record);
}

/** Read access, gated to the ride's own passenger — mirrors
 * rideLifecycleService.getRideForUser's not-found-not-forbidden
 * treatment for a mismatched caller. */
export async function getPaymentForRide(rideId: string, userId: string): Promise<Payment> {
  const passenger = await findPassengerProfileByUserId(userId);
  if (!passenger) throw new Error('Passenger profile not found for authenticated passenger user');

  const ride = await findRideById(rideId);
  if (!ride || ride.passengerId !== passenger.id) {
    throw new NotFoundError('Ride not found');
  }

  const record = await findLatestPaymentRecordForRide(rideId);
  if (!record) throw new NotFoundError('No payment has been created for this ride yet');

  return toPayment(record);
}

export async function updateDefaultTestPaymentMethod(
  userId: string,
  testPaymentMethodId: string,
): Promise<void> {
  if (!isKnownTestPaymentMethod(testPaymentMethodId)) {
    throw new ValidationError('Unrecognized test payment method id', {
      testPaymentMethodId: ['Must be one of the documented Stripe TEST MODE payment method ids'],
    });
  }

  const passenger = await findPassengerProfileByUserId(userId);
  if (!passenger) throw new Error('Passenger profile not found for authenticated passenger user');

  await setPassengerDefaultTestPaymentMethod(passenger.id, testPaymentMethodId);
}

/**
 * POST /webhooks/stripe. Verifies the signature first — an unsigned or
 * incorrectly-signed body is never trusted (section 11's "signature
 * verification"), then performs the same compare-and-swap
 * markPaymentOutcome uses, keyed by provider reference since a webhook
 * delivery only carries that, never our internal payment_records.id.
 * Idempotent: Stripe (and this sandbox's own tests) can redeliver the
 * same event; the compare-and-swap makes a redelivery after the outcome
 * already landed a no-op rather than a double-count.
 */
export async function handleStripeWebhookEvent(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
): Promise<void> {
  if (!stripeWebhookSecret) {
    throw new ConflictError('Stripe webhook secret is not configured');
  }
  if (!signatureHeader) {
    throw new ValidationError('Missing Stripe-Signature header');
  }

  let event: PaymentWebhookEvent;
  try {
    event = paymentProvider.verifyWebhookSignature(rawBody, signatureHeader, stripeWebhookSecret);
  } catch (error) {
    logger.warn({ err: error }, 'Rejected a Stripe webhook delivery with an invalid signature');
    throw new ForbiddenError('Invalid webhook signature');
  }

  const record = await findPaymentRecordByProviderPaymentIntentId(event.providerPaymentIntentId);
  if (!record) {
    // Nothing local to reconcile against (e.g. a delivery for an intent
    // this environment never created). Accepted, not an error, so the
    // provider does not retry forever over something we'll never resolve.
    logger.warn(
      { providerPaymentIntentId: event.providerPaymentIntentId },
      'Received a Stripe webhook for an unknown payment intent',
    );
    return;
  }

  await markPaymentOutcomeByProviderPaymentIntentId({
    providerPaymentIntentId: event.providerPaymentIntentId,
    toStatus: event.type === 'payment_intent.succeeded' ? 'SUCCEEDED' : 'FAILED',
    failureReason: event.failureReason ?? null,
  });
}

/**
 * Refund architecture (section 11): full refunds only in Stage 1 — no
 * partial-refund support (known limitation, see docs/payments.md). Not
 * yet exposed via a passenger- or admin-facing route; Phase 12's admin
 * payment/revenue visibility is the natural home for surfacing this.
 * Exercised directly by tests so the capability is real, not merely
 * declared in the type system.
 */
export async function refundPayment(paymentRecordId: string, reason?: string): Promise<Payment> {
  const record = await findPaymentRecordById(paymentRecordId);
  if (!record) throw new NotFoundError('Payment record not found');
  if (record.status !== 'SUCCEEDED') {
    throw new ConflictError('Only a successfully charged payment can be refunded');
  }
  if (!record.providerPaymentIntentId) {
    throw new Error('Payment record is missing its provider reference and cannot be refunded');
  }

  await paymentProvider.refundPaymentIntent(record.providerPaymentIntentId, reason);

  const updated = await markPaymentRefunded(paymentRecordId, reason);
  if (!updated) {
    throw new ConflictError('Payment is no longer in a refundable state');
  }
  return toPayment(updated);
}
