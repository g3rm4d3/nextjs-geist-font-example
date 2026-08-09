import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { userRoleEnum } from './enums';

/**
 * One row per account, regardless of role. PASSENGER/DRIVER accounts are
 * extended by passenger_profiles/driver_profiles (1:1); ADMIN/SUPER_ADMIN
 * accounts have no such profile — see docs/database.md.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    uniqueIndex('users_phone_key').on(table.phone),
    index('users_role_idx').on(table.role),
    // Enforces normalized-lowercase email at the database level so two
    // accounts can never differ only by email casing, regardless of which
    // application/script wrote the row.
    check('users_email_lowercase_chk', sql`${table.email} = lower(${table.email})`),
  ],
);
