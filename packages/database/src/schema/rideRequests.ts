import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    // PHASE 21: a driver may only ever hold one *open* offer at a time,
    // full stop — not just "one per ride" (a driver may legitimately be
    // re-offered the *same* ride later, e.g. after other candidates
    // declined, so this isn't scoped to rideId) but one globally, since
    // findEligibleDrivers excludes any driver already holding an OFFERED
    // row and getCurrentOffer's own `.limit(1)` assumes there is never
    // more than one. This used to be a plain (non-unique) index on
    // (rideId, driverId) — which didn't actually stop two *different*
    // rides' independent, concurrent matching attempts from both reading
    // "driver X is free" and both inserting an OFFERED row for driver X
    // a moment apart. Found by exactly that race in
    // routes/driverOffers.test.ts's "concurrent ride requests" test —
    // the loser's offer sat live but invisible to the driver (a query
    // limited to one row) until the 15s sweep silently expired it. Now a
    // real UNIQUE constraint scoped to `driverId` alone (see
    // matchingRepository.createOffer for how the losing side of that
    // race is handled: not an error, just "try the next candidate").
    uniqueIndex('ride_requests_one_open_offer_per_driver_key')
      .on(table.driverId)
      .where(sql`${table.status} = 'OFFERED'`),
  ],
);
