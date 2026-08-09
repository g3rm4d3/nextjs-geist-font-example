import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { rideRequestStatusEnum } from './enums';
import { rides } from './rides';
import { driverProfiles } from './drivers';

/**
 * One row per candidate driver offered a ride during matching (Phase 8) —
 * distinct from `rides`, which holds the ride itself. A single ride can
 * produce several ride_requests as the matching engine tries candidates in
 * sequence (offer → ACCEPT/DECLINE/TIMEOUT → next candidate).
 */
export const rideRequests = pgTable(
  'ride_requests',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'cascade' }),
    status: rideRequestStatusEnum('status').notNull().default('OFFERED'),
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('ride_requests_ride_id_idx').on(table.rideId),
    index('ride_requests_driver_id_idx').on(table.driverId),
    index('ride_requests_status_idx').on(table.status),
    // A driver should only ever have one *open* offer for a given ride at
    // a time, but may legitimately be re-offered the same ride later
    // (e.g. after other candidates declined) — so this is not a bare
    // unique(rideId, driverId); it's scoped to the still-open state.
    index('ride_requests_open_offer_idx')
      .on(table.rideId, table.driverId)
      .where(sql`${table.status} = 'OFFERED'`),
  ],
);
