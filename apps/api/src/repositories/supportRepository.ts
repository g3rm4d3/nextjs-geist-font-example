import { schema } from '@rideshare/database';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type SupportTicketRow = typeof schema.supportTickets.$inferSelect;
export type SupportMessageRow = typeof schema.supportMessages.$inferSelect;

export interface SupportTicketAdminRow {
  id: string;
  userId: string;
  subject: string;
  status: SupportTicketRow['status'];
  rideId: string | null;
  createdAt: Date;
  passengerFirstName: string | null;
  passengerLastName: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
}

/**
 * Section 18's support-ticket schema (already fully defined); this phase
 * is the first to read it. A ticket's `userId` can belong to either a
 * passenger or a driver account (the two profile tables are mutually
 * exclusive per user — see docs/database.md), so both are left-joined
 * and the service layer picks whichever side is non-null.
 */
export async function listTickets(): Promise<SupportTicketAdminRow[]> {
  return db
    .select({
      id: schema.supportTickets.id,
      userId: schema.supportTickets.userId,
      subject: schema.supportTickets.subject,
      status: schema.supportTickets.status,
      rideId: schema.supportTickets.rideId,
      createdAt: schema.supportTickets.createdAt,
      passengerFirstName: schema.passengerProfiles.firstName,
      passengerLastName: schema.passengerProfiles.lastName,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
    })
    .from(schema.supportTickets)
    .leftJoin(schema.passengerProfiles, eq(schema.supportTickets.userId, schema.passengerProfiles.userId))
    .leftJoin(schema.driverProfiles, eq(schema.supportTickets.userId, schema.driverProfiles.userId))
    .orderBy(desc(schema.supportTickets.createdAt));
}

/** Section 14's "Dashboard": tickets still awaiting a first response —
 * OPEN specifically, not IN_PROGRESS/WAITING_USER (those are already
 * being worked). */
export async function countOpenTickets(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.status, 'OPEN'));
  return row?.total ?? 0;
}

export async function findTicketAdminRowById(
  ticketId: string,
): Promise<SupportTicketAdminRow | undefined> {
  const [row] = await db
    .select({
      id: schema.supportTickets.id,
      userId: schema.supportTickets.userId,
      subject: schema.supportTickets.subject,
      status: schema.supportTickets.status,
      rideId: schema.supportTickets.rideId,
      createdAt: schema.supportTickets.createdAt,
      passengerFirstName: schema.passengerProfiles.firstName,
      passengerLastName: schema.passengerProfiles.lastName,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
    })
    .from(schema.supportTickets)
    .leftJoin(schema.passengerProfiles, eq(schema.supportTickets.userId, schema.passengerProfiles.userId))
    .leftJoin(schema.driverProfiles, eq(schema.supportTickets.userId, schema.driverProfiles.userId))
    .where(eq(schema.supportTickets.id, ticketId))
    .limit(1);
  return row;
}

export interface SupportMessageAdminRow extends SupportMessageRow {
  authorFirstName: string | null;
  authorLastName: string | null;
}

/** Oldest-first — a message thread reads top-to-bottom chronologically,
 * unlike every other admin list in this phase (newest-first). */
export async function listMessagesForTicket(ticketId: string): Promise<SupportMessageAdminRow[]> {
  const rows = await db
    .select({
      id: schema.supportMessages.id,
      ticketId: schema.supportMessages.ticketId,
      authorUserId: schema.supportMessages.authorUserId,
      isInternalNote: schema.supportMessages.isInternalNote,
      body: schema.supportMessages.body,
      createdAt: schema.supportMessages.createdAt,
      passengerFirstName: schema.passengerProfiles.firstName,
      passengerLastName: schema.passengerProfiles.lastName,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
    })
    .from(schema.supportMessages)
    .leftJoin(schema.passengerProfiles, eq(schema.supportMessages.authorUserId, schema.passengerProfiles.userId))
    .leftJoin(schema.driverProfiles, eq(schema.supportMessages.authorUserId, schema.driverProfiles.userId))
    .where(eq(schema.supportMessages.ticketId, ticketId))
    .orderBy(asc(schema.supportMessages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    authorUserId: row.authorUserId,
    isInternalNote: row.isInternalNote,
    body: row.body,
    createdAt: row.createdAt,
    authorFirstName: row.passengerFirstName ?? row.driverFirstName,
    authorLastName: row.passengerLastName ?? row.driverLastName,
  }));
}

export interface CreateMessageInput {
  ticketId: string;
  authorUserId: string | null;
  isInternalNote: boolean;
  body: string;
}

/**
 * Phase 16's minimal admin-reply endpoint — the only writer of
 * support_messages in Stage 1 (Section 18's full passenger/driver-facing
 * ticket lifecycle, including a passenger opening a ticket in the first
 * place, is explicitly out of scope here; see adminSupportService.replyToTicket).
 */
export async function createMessage(input: CreateMessageInput): Promise<SupportMessageRow> {
  const [row] = await db
    .insert(schema.supportMessages)
    .values({
      ticketId: input.ticketId,
      authorUserId: input.authorUserId,
      isInternalNote: input.isInternalNote,
      body: input.body,
    })
    .returning();
  if (!row) throw new Error('Failed to insert support message');
  return row;
}

export interface CreateTicketInput {
  userId: string;
  subject: string;
  rideId: string | null;
}

/** Section 18: "Passenger App and Driver App: create support ticket."
 * Always starts `OPEN` (the column default). */
export async function createTicket(input: CreateTicketInput): Promise<SupportTicketRow> {
  const [row] = await db
    .insert(schema.supportTickets)
    .values({
      userId: input.userId,
      subject: input.subject,
      rideId: input.rideId,
    })
    .returning();
  if (!row) throw new Error('Failed to insert support ticket');
  return row;
}

/** A user's own ticket list, most recent first — same shape as every
 * other "my own X" list in this codebase (documentsRepository.findDocumentsByDriver,
 * notificationsRepository.listNotificationsForUser). */
export async function findTicketsForUser(userId: string): Promise<SupportTicketRow[]> {
  return db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.userId, userId))
    .orderBy(desc(schema.supportTickets.createdAt));
}

/** Plain lookup, no join — for an ownership check (supportService) or
 * as the "before" read ahead of a status change (adminSupportService). */
export async function findTicketById(ticketId: string): Promise<SupportTicketRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.id, ticketId))
    .limit(1);
  return row;
}

/** The ticket-owner-facing message thread — deliberately excludes
 * `isInternalNote` rows at the query level (not just filtered out
 * downstream) so an admin-only note can never leak to the ticket's
 * owner through this path, regardless of what the service layer does
 * with the result. Oldest first, same reading order as the admin
 * thread view (listMessagesForTicket). */
export async function listUserVisibleMessagesForTicket(ticketId: string): Promise<SupportMessageRow[]> {
  return db
    .select()
    .from(schema.supportMessages)
    .where(and(eq(schema.supportMessages.ticketId, ticketId), eq(schema.supportMessages.isInternalNote, false)))
    .orderBy(asc(schema.supportMessages.createdAt));
}

/**
 * Section 18's "change status." Unlike a ride's forward-only lifecycle
 * (rideLifecycleService's compare-and-swap transitions), a support
 * ticket has no fixed transition graph in the spec — any of the five
 * states can move to any other — so this is a plain unconditional
 * update, not a conditional one keyed on the current status.
 */
export async function updateTicketStatus(
  ticketId: string,
  status: SupportTicketRow['status'],
): Promise<SupportTicketRow | undefined> {
  const [row] = await db
    .update(schema.supportTickets)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.supportTickets.id, ticketId))
    .returning();
  return row;
}
