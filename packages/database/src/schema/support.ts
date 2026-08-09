import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { supportTicketStatusEnum } from './enums';
import { rides } from './rides';
import { users } from './users';

/** Phase 18 — support ticket, optionally tied to a specific ride. */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id').references(() => rides.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: supportTicketStatusEnum('status').notNull().default('OPEN'),
    ...timestamps,
  },
  (table) => [
    index('support_tickets_user_id_idx').on(table.userId),
    index('support_tickets_ride_id_idx').on(table.rideId),
    index('support_tickets_status_idx').on(table.status),
  ],
);

/** Thread of messages on a ticket, including admin-only internal notes. */
export const supportMessages = pgTable(
  'support_messages',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    // Null for system-generated messages (e.g. automated status-change notes).
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    isInternalNote: boolean('is_internal_note').notNull().default(false),
    body: text('body').notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index('support_messages_ticket_id_idx').on(table.ticketId)],
);
