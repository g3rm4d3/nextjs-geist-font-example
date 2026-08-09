import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { cancelledByActorEnum, rideStatusEnum } from './enums';
import { driverProfiles } from './drivers';
import { passengerProfiles } from './passengers';
import { vehicles } from './vehicles';

/**
 * The ride record itself. `status` holds the *current* state only — the
 * full transition history (previous → new, actor, timestamp, location) is
 * the immutable `ride_events` log, not this row. See docs/database.md and
 * (in Phase 12) docs/ride-state-machine.md.
 *
 * Money is always integer cents (section 10) — never floating point.
 */
export const rides = pgTable(
  'rides',
  {
    id: primaryId(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => passengerProfiles.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => driverProfiles.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'restrict' }),
    status: rideStatusEnum('status').notNull().default('REQUESTED'),

    // Phase 7: client-generated, one per logical request attempt. Lets
    // POST /rides be safely retried (a genuine network retry, or a
    // passenger double-tapping before the button disables) without
    // creating a second ride — see rides_passenger_idempotency_key_key
    // below and docs/ride-requests.md.
    idempotencyKey: text('idempotency_key').notNull(),

    pickupAddress: text('pickup_address').notNull(),
    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    destinationAddress: text('destination_address').notNull(),
    destinationLat: doublePrecision('destination_lat').notNull(),
    destinationLng: doublePrecision('destination_lng').notNull(),

    estimatedDistanceMeters: integer('estimated_distance_meters'),
    estimatedDurationSeconds: integer('estimated_duration_seconds'),
    estimatedFareCents: integer('estimated_fare_cents'),

    actualDistanceMeters: integer('actual_distance_meters'),
    actualDurationSeconds: integer('actual_duration_seconds'),
    finalFareCents: integer('final_fare_cents'),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: cancelledByActorEnum('cancelled_by'),
    cancellationReason: text('cancellation_reason'),

    ...timestamps,
  },
  (table) => [
    index('rides_passenger_id_idx').on(table.passengerId),
    index('rides_driver_id_idx').on(table.driverId),
    index('rides_status_idx').on(table.status),
    index('rides_requested_at_idx').on(table.requestedAt),
    // A repeat POST /rides with the same idempotency key from the same
    // passenger is a retry, not a new request — this is what makes that
    // safely detectable (and, under a race, safely resolvable: whichever
    // insert wins, the loser's unique-violation tells the service to
    // re-fetch and return the winner's row instead of erroring).
    uniqueIndex('rides_passenger_idempotency_key_key').on(
      table.passengerId,
      table.idempotencyKey,
    ),
    // Section 7's "passenger cannot accidentally create two active rides
    // through double-tapping" as an actual invariant, not just an
    // application-level check-then-insert (which would still race under
    // concurrent requests). Only one row per passenger may be in a
    // non-terminal status at a time.
    uniqueIndex('rides_one_active_per_passenger_key')
      .on(table.passengerId)
      .where(
        sql`${table.status} IN ('REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'PASSENGER_ONBOARD', 'IN_PROGRESS')`,
      ),
    check('rides_pickup_lat_range_chk', sql`${table.pickupLat} BETWEEN -90 AND 90`),
    check('rides_pickup_lng_range_chk', sql`${table.pickupLng} BETWEEN -180 AND 180`),
    check('rides_destination_lat_range_chk', sql`${table.destinationLat} BETWEEN -90 AND 90`),
    check('rides_destination_lng_range_chk', sql`${table.destinationLng} BETWEEN -180 AND 180`),
    check(
      'rides_estimated_fare_non_negative_chk',
      sql`${table.estimatedFareCents} IS NULL OR ${table.estimatedFareCents} >= 0`,
    ),
    check(
      'rides_final_fare_non_negative_chk',
      sql`${table.finalFareCents} IS NULL OR ${table.finalFareCents} >= 0`,
    ),
    check(
      'rides_estimated_distance_non_negative_chk',
      sql`${table.estimatedDistanceMeters} IS NULL OR ${table.estimatedDistanceMeters} >= 0`,
    ),
    check(
      'rides_actual_distance_non_negative_chk',
      sql`${table.actualDistanceMeters} IS NULL OR ${table.actualDistanceMeters} >= 0`,
    ),
    check(
      'rides_cancelled_fields_consistent_chk',
      sql`(${table.cancelledAt} IS NULL AND ${table.cancelledBy} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelledBy} IS NOT NULL)`,
    ),
  ],
);
