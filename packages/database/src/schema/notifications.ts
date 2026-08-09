import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_helpers';
import { users } from './users';

/** In-app notifications (Phase 16). Push delivery is a separate concern. */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Stable event key, e.g. "ride.driver_assigned" — see Phase 16's
    // NotificationProvider abstraction for the canonical event list.
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_user_id_unread_idx')
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
  ],
);
