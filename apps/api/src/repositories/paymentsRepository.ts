import { schema } from '@rideshare/database';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type PaymentRecordRow = typeof schema.paymentRecords.$inferSelect;
type PaymentStatusValue = PaymentRecordRow['status'];

export interface CreatePaymentRecordInput {
  rideId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

/** Always inserted as PENDING — a payment record only ever starts life
 * as an attempt in flight; nothing constructs one already SUCCEEDED or
 * FAILED (section 11). */
export async function createPaymentRecord(
  input: CreatePaymentRecordInput,
): Promise<PaymentRecordRow> {
  const [record] = await db
    .insert(schema.paymentRecords)
    .values({
      rideId: input.rideId,
      amountCents: input.amountCents,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
    })
    .returning();
  if (!record) throw new Error('Failed to create payment record');
  return record;
}

export async function findPaymentRecordByIdempotencyKey(
  idempotencyKey: string,
): Promise<PaymentRecordRow | undefined> {
  const [record] = await db
    .select()
    .from(schema.paymentRecords)
    .where(eq(schema.paymentRecords.idempotencyKey, idempotencyKey))
    .limit(1);
  return record;
}

/** Multiple attempts can exist per ride (retries after a failure) — this
 * is always "the current one" for display and for retry eligibility. */
export async function findLatestPaymentRecordForRide(
  rideId: string,
): Promise<PaymentRecordRow | undefined> {
  const [record] = await db
    .select()
    .from(schema.paymentRecords)
    .where(eq(schema.paymentRecords.rideId, rideId))
    .orderBy(desc(schema.paymentRecords.createdAt))
    .limit(1);
  return record;
}

export async function findPaymentRecordById(id: string): Promise<PaymentRecordRow | undefined> {
  const [record] = await db
    .select()
    .from(schema.paymentRecords)
    .where(eq(schema.paymentRecords.id, id))
    .limit(1);
  return record;
}

export async function findPaymentRecordByProviderPaymentIntentId(
  providerPaymentIntentId: string,
): Promise<PaymentRecordRow | undefined> {
  const [record] = await db
    .select()
    .from(schema.paymentRecords)
    .where(eq(schema.paymentRecords.providerPaymentIntentId, providerPaymentIntentId))
    .limit(1);
  return record;
}

export async function setProviderPaymentIntentId(
  paymentRecordId: string,
  providerPaymentIntentId: string,
): Promise<void> {
  await db
    .update(schema.paymentRecords)
    .set({ providerPaymentIntentId, updatedAt: new Date() })
    .where(eq(schema.paymentRecords.id, paymentRecordId));
}

export interface MarkPaymentOutcomeInput {
  paymentRecordId: string;
  toStatus: 'SUCCEEDED' | 'FAILED';
  failureReason?: string | null;
}

/**
 * Atomic conditional UPDATE...WHERE compare-and-swap — same pattern as
 * ridesRepository.advanceRideStatus. Only a PENDING record can resolve to
 * SUCCEEDED/FAILED, and only once: the synchronous confirm call and a
 * (simulated) webhook delivery for the same payment intent can race, and
 * whichever gets here second finds the row no longer PENDING and is a
 * no-op rather than double-processing the outcome.
 */
export async function markPaymentOutcome(
  input: MarkPaymentOutcomeInput,
): Promise<PaymentRecordRow | undefined> {
  const [updated] = await db
    .update(schema.paymentRecords)
    .set({
      status: input.toStatus,
      failureReason: input.failureReason ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentRecords.id, input.paymentRecordId),
        eq(schema.paymentRecords.status, 'PENDING' satisfies PaymentStatusValue),
      ),
    )
    .returning();
  return updated;
}

export interface MarkPaymentOutcomeByProviderIdInput {
  providerPaymentIntentId: string;
  toStatus: 'SUCCEEDED' | 'FAILED';
  failureReason?: string | null;
}

/** Same compare-and-swap as markPaymentOutcome, keyed by the provider's
 * reference id — the webhook handler only has that on hand, never our
 * internal payment_records.id. */
export async function markPaymentOutcomeByProviderPaymentIntentId(
  input: MarkPaymentOutcomeByProviderIdInput,
): Promise<PaymentRecordRow | undefined> {
  const [updated] = await db
    .update(schema.paymentRecords)
    .set({
      status: input.toStatus,
      failureReason: input.failureReason ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentRecords.providerPaymentIntentId, input.providerPaymentIntentId),
        eq(schema.paymentRecords.status, 'PENDING' satisfies PaymentStatusValue),
      ),
    )
    .returning();
  return updated;
}

/** Only a SUCCEEDED payment can be refunded — Stage 1 supports full
 * refunds only (known limitation, see docs/payments.md). */
export async function markPaymentRefunded(
  paymentRecordId: string,
  reason: string | undefined,
): Promise<PaymentRecordRow | undefined> {
  const [updated] = await db
    .update(schema.paymentRecords)
    .set({
      status: 'REFUNDED',
      refundedAt: new Date(),
      refundReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentRecords.id, paymentRecordId),
        eq(schema.paymentRecords.status, 'SUCCEEDED' satisfies PaymentStatusValue),
      ),
    )
    .returning();
  return updated;
}

export interface PaymentAdminRow {
  id: string;
  rideId: string;
  status: PaymentStatusValue;
  amountCents: number;
  currency: string;
  providerPaymentIntentId: string | null;
  failureReason: string | null;
  refundedAt: Date | null;
  refundReason: string | null;
  passengerFirstName: string;
  passengerLastName: string;
  createdAt: Date;
}

const PAYMENT_ADMIN_ROW_SELECTION = {
  id: schema.paymentRecords.id,
  rideId: schema.paymentRecords.rideId,
  status: schema.paymentRecords.status,
  amountCents: schema.paymentRecords.amountCents,
  currency: schema.paymentRecords.currency,
  providerPaymentIntentId: schema.paymentRecords.providerPaymentIntentId,
  failureReason: schema.paymentRecords.failureReason,
  refundedAt: schema.paymentRecords.refundedAt,
  refundReason: schema.paymentRecords.refundReason,
  passengerFirstName: schema.passengerProfiles.firstName,
  passengerLastName: schema.passengerProfiles.lastName,
  createdAt: schema.paymentRecords.createdAt,
};

const DEFAULT_ADMIN_PAYMENT_LIST_LIMIT = 100;

/** Section 14's "Payments" — every payment attempt across every ride,
 * newest first, `?status=` narrows to one. */
export async function listAllPaymentsForAdmin(
  limit = DEFAULT_ADMIN_PAYMENT_LIST_LIMIT,
  statusFilter?: PaymentStatusValue,
): Promise<PaymentAdminRow[]> {
  return db
    .select(PAYMENT_ADMIN_ROW_SELECTION)
    .from(schema.paymentRecords)
    .innerJoin(schema.rides, eq(schema.paymentRecords.rideId, schema.rides.id))
    .innerJoin(schema.passengerProfiles, eq(schema.rides.passengerId, schema.passengerProfiles.id))
    .where(statusFilter ? eq(schema.paymentRecords.status, statusFilter) : undefined)
    .orderBy(desc(schema.paymentRecords.createdAt))
    .limit(limit);
}

/** "Inspect payment." */
export async function findPaymentAdminRowById(
  paymentRecordId: string,
): Promise<PaymentAdminRow | undefined> {
  const [row] = await db
    .select(PAYMENT_ADMIN_ROW_SELECTION)
    .from(schema.paymentRecords)
    .innerJoin(schema.rides, eq(schema.paymentRecords.rideId, schema.rides.id))
    .innerJoin(schema.passengerProfiles, eq(schema.rides.passengerId, schema.passengerProfiles.id))
    .where(eq(schema.paymentRecords.id, paymentRecordId))
    .limit(1);
  return row;
}
