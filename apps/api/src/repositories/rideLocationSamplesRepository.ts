import { schema } from '@rideshare/database';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type RideLocationSampleRow = typeof schema.rideLocationSamples.$inferSelect;

/** The most recently recorded sample for a ride, if any — used only to
 * decide whether enough time has passed (RIDE_LOCATION_SAMPLE_INTERVAL_MS)
 * to record another one. */
export async function findLatestRideLocationSample(
  rideId: string,
): Promise<RideLocationSampleRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rideLocationSamples)
    .where(eq(schema.rideLocationSamples.rideId, rideId))
    .orderBy(desc(schema.rideLocationSamples.recordedAt))
    .limit(1);
  return row;
}

export interface InsertRideLocationSampleInput {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: Date;
}

export async function insertRideLocationSample(
  rideId: string,
  input: InsertRideLocationSampleInput,
): Promise<RideLocationSampleRow> {
  const [row] = await db
    .insert(schema.rideLocationSamples)
    .values({
      rideId,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading,
      speed: input.speed,
      accuracy: input.accuracy,
      recordedAt: input.recordedAt,
    })
    .returning();
  if (!row) throw new Error('Failed to insert ride location sample');
  return row;
}

/** Every sample for a ride, oldest first — the breadcrumb trail
 * rideLifecycleService.completeRide sums (consecutive haversine
 * distances) into an actual trip distance. */
export async function findRideLocationSamples(rideId: string): Promise<RideLocationSampleRow[]> {
  return db
    .select()
    .from(schema.rideLocationSamples)
    .where(eq(schema.rideLocationSamples.rideId, rideId))
    .orderBy(asc(schema.rideLocationSamples.recordedAt));
}
