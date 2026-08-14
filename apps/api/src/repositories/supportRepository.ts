import { schema } from '@rideshare/database';
import { asc, count, desc, eq } from 'drizzle-orm';
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
