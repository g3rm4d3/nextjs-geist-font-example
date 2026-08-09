import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './_helpers';
import { users } from './users';

/**
 * One row per issued refresh token (Phase 2). Only a SHA-256 hash of the
 * token is ever stored — never the raw value, same rationale as
 * password_reset_tokens below. `revokedAt` implements real logout and
 * refresh-token rotation (a token is revoked the moment it's exchanged for
 * a new one, or the moment a user logs out).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_refresh_token_hash_key').on(table.refreshTokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
);
