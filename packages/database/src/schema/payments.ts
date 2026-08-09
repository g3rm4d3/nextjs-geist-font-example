import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { paymentStatusEnum } from './enums';
import { rides } from './rides';

/**
 * Payment attempts for a ride (Phase 11 — Stripe TEST MODE only in Stage
 * 1). Multiple rows per ride are allowed (retries after a failed
 * attempt); `idempotencyKey` prevents the same client-initiated attempt
 * from being charged twice. Only provider-safe references are stored —
 * never raw card data (section 7/section 10).
 */
export const paymentRecords = pgTable(
  'payment_records',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'restrict' }),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    provider: text('provider').notNull().default('stripe'),
    providerPaymentIntentId: text('provider_payment_intent_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (table) => [
    index('payment_records_ride_id_idx').on(table.rideId),
    index('payment_records_status_idx').on(table.status),
    uniqueIndex('payment_records_idempotency_key_key').on(table.idempotencyKey),
    uniqueIndex('payment_records_provider_payment_intent_id_key').on(table.providerPaymentIntentId),
    check('payment_records_amount_non_negative_chk', sql`${table.amountCents} >= 0`),
  ],
);
