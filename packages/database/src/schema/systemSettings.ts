import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './_helpers';
import { users } from './users';

/** Generic admin-editable key/value platform settings. */
export const systemSettings = pgTable(
  'system_settings',
  {
    id: primaryId(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [uniqueIndex('system_settings_key_key').on(table.key)],
);
