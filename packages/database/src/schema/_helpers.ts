import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Standard UUID primary key, generated server-side by Postgres. */
export function primaryId() {
  return uuid('id').primaryKey().defaultRandom();
}

/** Standard created_at/updated_at pair used on every table. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
