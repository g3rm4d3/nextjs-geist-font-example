import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { vehicleStatusEnum } from './enums';
import { driverProfiles } from './drivers';

export const vehicles = pgTable(
  'vehicles',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'cascade' }),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    color: text('color').notNull(),
    licensePlate: text('license_plate').notNull(),
    vin: text('vin'),
    seats: integer('seats').notNull(),
    status: vehicleStatusEnum('status').notNull().default('ACTIVE'),
    // Only one vehicle can be a driver's *active* vehicle at a time; older
    // vehicles are kept for ride history rather than deleted.
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index('vehicles_driver_id_idx').on(table.driverId),
    uniqueIndex('vehicles_license_plate_key').on(table.licensePlate),
    uniqueIndex('vehicles_vin_key').on(table.vin),
    uniqueIndex('vehicles_one_active_per_driver_key')
      .on(table.driverId)
      .where(sql`${table.isActive} = true`),
    check('vehicles_year_plausible_chk', sql`${table.year} BETWEEN 1980 AND 2100`),
    check('vehicles_seats_positive_chk', sql`${table.seats} > 0`),
  ],
);
