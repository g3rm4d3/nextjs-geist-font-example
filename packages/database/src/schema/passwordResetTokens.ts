import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './_helpers';
import { users } from './users';

/**
 * One row per requested password reset (Phase 2). Only a SHA-256 hash of
 * the token is stored — a leaked database dump alone is never enough to
 * reset someone's password. `usedAt` makes a token single-use.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_token_hash_key').on(table.tokenHash),
    index('password_reset_tokens_user_id_idx').on(table.userId),
  ],
);
