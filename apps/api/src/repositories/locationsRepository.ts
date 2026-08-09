import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';

export type DriverLocationRow = typeof schema.driverLocations.$inferSelect;

export async function findDriverLocation(driverId: string): Promise<DriverLocationRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.driverLocations)
    .where(eq(schema.driverLocations.driverId, driverId))
    .limit(1);
  return row;
}

export interface UpsertLocationInput {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: Date;
}

/**
 * One row per driver, upserted in place (`driver_locations_driver_id_key`
 * — a unique index on driverId, see packages/database/src/schema/locations.ts).
 * This is the whole answer to "avoid excessive database writes" at the
 * storage-growth level: no matter how many pings a driver sends, this
 * table never grows past one row per driver. Write *frequency* (I/O) is
 * a separate concern, throttled in locationService before this is ever
 * called.
 */
export async function upsertDriverLocation(
  driverId: string,
  input: UpsertLocationInput,
): Promise<DriverLocationRow> {
  const [row] = await db
    .insert(schema.driverLocations)
    .values({
      driverId,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading,
      speed: input.speed,
      accuracy: input.accuracy,
      recordedAt: input.recordedAt,
    })
    .onConflictDoUpdate({
      target: schema.driverLocations.driverId,
      set: {
        latitude: input.latitude,
        longitude: input.longitude,
        heading: input.heading,
        speed: input.speed,
        accuracy: input.accuracy,
        recordedAt: input.recordedAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('Failed to upsert driver location');
  return row;
}

export interface FleetLocationRow {
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  recordedAt: Date;
  firstName: string;
  lastName: string;
  availabilityStatus: (typeof schema.driverAvailabilityStatusEnum.enumValues)[number];
}

/**
 * Everything the admin live map (Phase 6's other requirement) needs in
 * one query — every driver with a location on file, plus enough profile
 * data to label a marker. Not filtered to ONLINE-only here: an admin
 * debugging "why isn't this driver showing up" needs to see OFFLINE
 * drivers' last-known positions too.
 */
export async function listFleetLocations(): Promise<FleetLocationRow[]> {
  return db
    .select({
      driverId: schema.driverLocations.driverId,
      latitude: schema.driverLocations.latitude,
      longitude: schema.driverLocations.longitude,
      heading: schema.driverLocations.heading,
      speed: schema.driverLocations.speed,
      accuracy: schema.driverLocations.accuracy,
      recordedAt: schema.driverLocations.recordedAt,
      firstName: schema.driverProfiles.firstName,
      lastName: schema.driverProfiles.lastName,
      availabilityStatus: schema.driverProfiles.availabilityStatus,
    })
    .from(schema.driverLocations)
    .innerJoin(schema.driverProfiles, eq(schema.driverLocations.driverId, schema.driverProfiles.id));
}
