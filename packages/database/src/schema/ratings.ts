import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { ratingDirectionEnum } from './enums';
import { rides } from './rides';
import { users } from './users';

/**
 * One row per (ride, direction) — a passenger rating a driver and a driver
 * rating a passenger are two independent rows for the same ride, each
 * unique per direction (Phase 13: "one rating per direction per completed
 * ride").
 */
export const ratings = pgTable(
  'ratings',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    raterUserId: uuid('rater_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rateeUserId: uuid('ratee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: ratingDirectionEnum('direction').notNull(),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex('ratings_ride_direction_key').on(table.rideId, table.direction),
    index('ratings_ratee_user_id_idx').on(table.rateeUserId),
    check('ratings_stars_range_chk', sql`${table.stars} BETWEEN 1 AND 5`),
  ],
);
