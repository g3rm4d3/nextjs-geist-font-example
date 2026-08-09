import { doublePrecision, index, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { rideEventActorTypeEnum, rideStatusEnum } from './enums';
import { rides } from './rides';
import { users } from './users';

/**
 * Immutable audit trail of ride state transitions (section 12). Rows are
 * append-only — nothing in this schema updates or deletes a ride_events
 * row; application code must never do so either.
 */
export const rideEvents = pgTable(
  'ride_events',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    previousStatus: rideStatusEnum('previous_status'),
    newStatus: rideStatusEnum('new_status').notNull(),
    actorType: rideEventActorTypeEnum('actor_type').notNull(),
    // Null when actorType = 'SYSTEM'.
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    metadata: jsonb('metadata'),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('ride_events_ride_id_idx').on(table.rideId),
    index('ride_events_created_at_idx').on(table.createdAt),
  ],
);
