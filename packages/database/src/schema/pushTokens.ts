import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { users } from './users';

/**
 * Phase 16 — one row per registered device/installation. `token` is
 * globally unique (not per-user): a given device token identifies one
 * installation regardless of who is currently logged into it, so
 * re-registering the same token under a different account updates the
 * existing row's `userId` rather than creating a duplicate (the app was
 * logged out and back in as someone else on the same device). A user
 * can have more than one row (multiple devices).
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    // Free text ("ios" / "android" / "web") rather than an enum — purely
    // informational (e.g. for admin debugging), nothing branches on it.
    platform: text('platform'),
    ...timestamps,
  },
  (table) => [uniqueIndex('push_tokens_token_key').on(table.token)],
);
