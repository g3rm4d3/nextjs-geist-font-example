import { check, index, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { payoutStatusEnum } from './enums';
import { driverProfiles } from './drivers';
import { rides } from './rides';

/**
 * Ledger-style record of what a completed ride earned a driver (section
 * 10 — "Maintain ledger-style records for driver earnings rather than
 * relying only on recalculated UI totals"). One row per completed ride;
 * `payoutStatus` is a Stage 1 placeholder — no real payouts happen yet
 * (Phase 12).
 */
export const driverEarnings = pgTable(
  'driver_earnings',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'restrict' }),
    grossFareCents: integer('gross_fare_cents').notNull(),
    platformCommissionCents: integer('platform_commission_cents').notNull(),
    driverGrossEarningsCents: integer('driver_gross_earnings_cents').notNull(),
    adjustmentsCents: integer('adjustments_cents').notNull().default(0),
    payoutStatus: payoutStatusEnum('payout_status').notNull().default('PENDING'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('driver_earnings_ride_id_key').on(table.rideId),
    index('driver_earnings_driver_id_idx').on(table.driverId),
    index('driver_earnings_payout_status_idx').on(table.payoutStatus),
    check('driver_earnings_gross_fare_non_negative_chk', sql`${table.grossFareCents} >= 0`),
    check(
      'driver_earnings_commission_non_negative_chk',
      sql`${table.platformCommissionCents} >= 0`,
    ),
    check(
      'driver_earnings_driver_gross_non_negative_chk',
      sql`${table.driverGrossEarningsCents} >= 0`,
    ),
    check(
      'driver_earnings_balance_chk',
      sql`${table.driverGrossEarningsCents} = ${table.grossFareCents} - ${table.platformCommissionCents}`,
    ),
  ],
);
