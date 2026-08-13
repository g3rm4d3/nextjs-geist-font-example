import { schema } from '@rideshare/database';
import { and, avg, count, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type RatingRow = typeof schema.ratings.$inferSelect;
type RatingDirectionValue = RatingRow['direction'];

export interface CreateRatingInput {
  rideId: string;
  raterUserId: string;
  rateeUserId: string;
  direction: RatingDirectionValue;
  stars: number;
  comment?: string | null;
}

/** `ratings_ride_direction_key` (a unique index) is the actual guarantee
 * behind "one rating per direction per completed ride" — callers
 * (ratingsService) check first via findRatingByRideAndDirection for a
 * friendly 409 rather than a raw constraint-violation error, the same
 * "read-first, write-once" shape used throughout this codebase. */
export async function createRating(input: CreateRatingInput): Promise<RatingRow> {
  const [row] = await db
    .insert(schema.ratings)
    .values({
      rideId: input.rideId,
      raterUserId: input.raterUserId,
      rateeUserId: input.rateeUserId,
      direction: input.direction,
      stars: input.stars,
      comment: input.comment ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create rating');
  return row;
}

export async function findRatingByRideAndDirection(
  rideId: string,
  direction: RatingDirectionValue,
): Promise<RatingRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.ratings)
    .where(and(eq(schema.ratings.rideId, rideId), eq(schema.ratings.direction, direction)))
    .limit(1);
  return row;
}

/** Both directions' ratings for one ride (0-2 rows) — the source for
 * GET .../ratings. */
export async function findRatingsForRide(rideId: string): Promise<RatingRow[]> {
  return db.select().from(schema.ratings).where(eq(schema.ratings.rideId, rideId));
}

export interface RatingAggregate {
  averageRating: string | null;
  ratingsCount: number;
}

/** Full recompute (not an incremental running average) over every
 * rating a user has ever received, regardless of direction — a real
 * user is only ever the ratee in one direction (a driver is never rated
 * DRIVER_TO_PASSENGER, a passenger never PASSENGER_TO_DRIVER), so this
 * is naturally direction-scoped without an explicit filter. Small
 * enough at Stage 1's ride volume that a full recompute on every new
 * rating is simpler and more honest than maintaining a running sum —
 * see docs/ratings.md. */
export async function sumRatingsForRatee(rateeUserId: string): Promise<RatingAggregate> {
  const [row] = await db
    .select({ averageRating: avg(schema.ratings.stars), ratingsCount: count() })
    .from(schema.ratings)
    .where(eq(schema.ratings.rateeUserId, rateeUserId));
  if (!row) throw new Error('Aggregate query unexpectedly returned no rows');
  return row;
}

export async function updateDriverRatingAggregate(
  driverProfileId: string,
  aggregate: RatingAggregate,
): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({
      averageRating: aggregate.averageRating,
      ratingsCount: aggregate.ratingsCount,
      updatedAt: new Date(),
    })
    .where(eq(schema.driverProfiles.id, driverProfileId));
}

export async function updatePassengerRatingAggregate(
  passengerProfileId: string,
  aggregate: RatingAggregate,
): Promise<void> {
  await db
    .update(schema.passengerProfiles)
    .set({
      averageRating: aggregate.averageRating,
      ratingsCount: aggregate.ratingsCount,
      updatedAt: new Date(),
    })
    .where(eq(schema.passengerProfiles.id, passengerProfileId));
}
