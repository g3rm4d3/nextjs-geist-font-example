import {
  check,
  doublePrecision,
  index,
  pgTable,
  real,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_helpers';
import { driverProfiles } from './drivers';
import { rides } from './rides';

/**
 * Latest known location per driver — one row per driver, upserted on every
 * ping (Phase 6). This is the high-frequency, overwrite-in-place table;
 * `ride_location_samples` below is the sparser historical breadcrumb trail
 * for a specific ride. Keeping them separate avoids either writing
 * history at "current location" frequency or losing history to
 * overwrites.
 */
export const driverLocations = pgTable(
  'driver_locations',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    heading: real('heading'),
    speed: real('speed'),
    accuracy: real('accuracy'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('driver_locations_driver_id_key').on(table.driverId),
    check('driver_locations_lat_range_chk', sql`${table.latitude} BETWEEN -90 AND 90`),
    check('driver_locations_lng_range_chk', sql`${table.longitude} BETWEEN -180 AND 180`),
  ],
);

/** Historical route samples captured during an active ride (Phase 10). */
export const rideLocationSamples = pgTable(
  'ride_location_samples',
  {
    id: primaryId(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    heading: real('heading'),
    speed: real('speed'),
    accuracy: real('accuracy'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ride_location_samples_ride_id_idx').on(table.rideId),
    index('ride_location_samples_recorded_at_idx').on(table.recordedAt),
    check('ride_location_samples_lat_range_chk', sql`${table.latitude} BETWEEN -90 AND 90`),
    check('ride_location_samples_lng_range_chk', sql`${table.longitude} BETWEEN -180 AND 180`),
  ],
);
