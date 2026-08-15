import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { backgroundCheckStatusEnum } from './enums';
import { driverProfiles } from './drivers';
import { users } from './users';

/**
 * Phase 15 — one row per background-check run against a driver. A real
 * provider is typically async (submit -> webhook/poll later); modeled
 * with separate requestedAt/completedAt even though the MOCK provider
 * (section 13: "BackgroundCheckProvider = MOCK ONLY") completes
 * synchronously, so a real provider could be swapped in later without a
 * schema change. Every past run stays in the table (nothing here ever
 * deletes a row) — an admin can see the full history, not just the
 * latest result.
 */
export const backgroundChecks = pgTable(
  'background_checks',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'cascade' }),
    status: backgroundCheckStatusEnum('status').notNull().default('PENDING'),
    // Provider-safe opaque reference (mirrors PaymentProvider's
    // providerPaymentIntentId) — never raw report contents.
    providerReportId: text('provider_report_id'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('background_checks_driver_id_idx').on(table.driverId),
    index('background_checks_status_idx').on(table.status),
  ],
);
