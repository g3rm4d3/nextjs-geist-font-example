import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { driverAvailabilityStatusEnum, driverOnboardingStatusEnum } from './enums';
import { users } from './users';

/** 1:1 extension of a users row with role = 'DRIVER'. */
export const driverProfiles = pgTable(
  'driver_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    licenseNumber: text('license_number').notNull(),
    licenseState: text('license_state').notNull(),
    licenseExpiresAt: timestamp('license_expires_at', { withTimezone: true }),
    // Approval pipeline — see driverOnboardingStatusEnum.
    onboardingStatus: driverOnboardingStatusEnum('onboarding_status').notNull().default('DRAFT'),
    // Operational availability — modeled separately from approval on
    // purpose (section 9). Only meaningful once onboardingStatus is
    // APPROVED; enforced below.
    availabilityStatus: driverAvailabilityStatusEnum('availability_status')
      .notNull()
      .default('OFFLINE'),
    averageRating: numeric('average_rating', { precision: 3, scale: 2 }),
    // Count of ratings actually received (Phase 13) — distinct from
    // totalRides (count of completed rides, unrelated to whether the
    // passenger rated any of them). Recomputed alongside averageRating
    // whenever a new PASSENGER_TO_DRIVER rating lands.
    ratingsCount: integer('ratings_count').notNull().default(0),
    totalRides: integer('total_rides').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('driver_profiles_user_id_key').on(table.userId),
    uniqueIndex('driver_profiles_license_number_key').on(table.licenseNumber),
    index('driver_profiles_onboarding_status_idx').on(table.onboardingStatus),
    index('driver_profiles_availability_status_idx').on(table.availabilityStatus),
    check('driver_profiles_total_rides_non_negative_chk', sql`${table.totalRides} >= 0`),
    check('driver_profiles_ratings_count_non_negative_chk', sql`${table.ratingsCount} >= 0`),
    // "Only APPROVED drivers may become available to receive rides."
    check(
      'driver_profiles_availability_requires_approval_chk',
      sql`${table.availabilityStatus} = 'OFFLINE' OR ${table.onboardingStatus} = 'APPROVED'`,
    ),
  ],
);
