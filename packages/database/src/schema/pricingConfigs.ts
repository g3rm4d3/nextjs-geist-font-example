import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';

/**
 * Table only, per section 11's core domain list. The pricing *engine*
 * that reads this table (base fare / per-mile / per-minute / minimum
 * fare / booking fee / cancellation fee / commission %) is Phase 4 —
 * nothing here computes a fare yet.
 */
export const pricingConfigs = pgTable(
  'pricing_configs',
  {
    id: primaryId(),
    name: text('name').notNull(),
    baseFareCents: integer('base_fare_cents').notNull(),
    perMileRateCents: integer('per_mile_rate_cents').notNull(),
    perMinuteRateCents: integer('per_minute_rate_cents').notNull(),
    minimumFareCents: integer('minimum_fare_cents').notNull(),
    bookingFeeCents: integer('booking_fee_cents').notNull(),
    cancellationFeeCents: integer('cancellation_fee_cents').notNull(),
    platformCommissionPercentage: numeric('platform_commission_percentage', {
      precision: 5,
      scale: 2,
    }).notNull(),
    active: boolean('active').notNull().default(false),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('pricing_configs_name_key').on(table.name),
    // At most one active pricing config at a time — the pricing engine
    // (Phase 4) can rely on "the active row" being unambiguous.
    uniqueIndex('pricing_configs_one_active_key')
      .on(table.active)
      .where(sql`${table.active} = true`),
    check(
      'pricing_configs_commission_range_chk',
      sql`${table.platformCommissionPercentage} BETWEEN 0 AND 100`,
    ),
    check('pricing_configs_base_fare_non_negative_chk', sql`${table.baseFareCents} >= 0`),
    check('pricing_configs_per_mile_non_negative_chk', sql`${table.perMileRateCents} >= 0`),
    check('pricing_configs_per_minute_non_negative_chk', sql`${table.perMinuteRateCents} >= 0`),
    check('pricing_configs_minimum_fare_non_negative_chk', sql`${table.minimumFareCents} >= 0`),
    check('pricing_configs_booking_fee_non_negative_chk', sql`${table.bookingFeeCents} >= 0`),
    check(
      'pricing_configs_cancellation_fee_non_negative_chk',
      sql`${table.cancellationFeeCents} >= 0`,
    ),
  ],
);
