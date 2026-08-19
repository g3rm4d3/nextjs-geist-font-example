import type { SupportMessage, SupportTicket, SupportTicketDetail } from '@rideshare/types';
import type { CreateSupportTicketInput } from '@rideshare/validation';
import { NotFoundError, ValidationError } from '../lib/errors';
import { findRideById } from '../repositories/ridesRepository';
import {
  createMessage,
  createTicket as createTicketRow,
  findTicketById,
  findTicketsForUser,
  listUserVisibleMessagesForTicket,
  type SupportMessageRow,
  type SupportTicketRow,
} from '../repositories/supportRepository';
import { findDriverProfileByUserId, findPassengerProfileByUserId } from '../repositories/usersRepository';

function toSupportTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    rideId: row.rideId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSupportMessage(row: SupportMessageRow, ownerUserId: string): SupportMessage {
  return {
    id: row.id,
    body: row.body,
    // Any message not authored by the ticket's own owner is a reply —
    // including a null-author system message, which is never something
    // the owner themselves wrote.
    isFromSupport: row.authorUserId !== ownerUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A ride can only be referenced by the user it actually belongs to —
 * as either its passenger or its driver. Never trusted from the client
 * as-is (section 3's server-authoritative principle, applied to "which
 * ride is this ticket about" the same as everywhere else). */
async function requireOwnedRideId(userId: string, rideId: string): Promise<string> {
  const ride = await findRideById(rideId);
  if (!ride) {
    throw new ValidationError('This ride does not exist', { rideId: ['This ride does not exist'] });
  }

  const [passengerProfile, driverProfile] = await Promise.all([
    findPassengerProfileByUserId(userId),
    findDriverProfileByUserId(userId),
  ]);
  const ownsAsPassenger = passengerProfile && ride.passengerId === passengerProfile.id;
  const ownsAsDriver = driverProfile && ride.driverId === driverProfile.id;

  if (!ownsAsPassenger && !ownsAsDriver) {
    throw new ValidationError('This ride does not belong to you', {
      rideId: ['This ride does not belong to you'],
    });
  }

  return ride.id;
}

/**
 * Section 18: "Passenger App and Driver App: create support ticket.
 * Ticket can reference ride." Always starts `OPEN`, and always seeds
 * the thread with the caller's own opening message — a ticket with a
 * subject but no body would be an empty complaint an admin can't act
 * on. Not audited: creating one's own support ticket is not an admin
 * action (Section 14's "sensitive admin operations generate audit
 * records" applies to admin*Service functions, not this one).
 */
export async function createTicket(
  userId: string,
  input: CreateSupportTicketInput,
): Promise<SupportTicketDetail> {
  const rideId = input.rideId ? await requireOwnedRideId(userId, input.rideId) : null;

  const ticket = await createTicketRow({ userId, subject: input.subject, rideId });
  const message = await createMessage({
    ticketId: ticket.id,
    authorUserId: userId,
    isInternalNote: false,
    body: input.body,
  });

  return { ...toSupportTicket(ticket), messages: [toSupportMessage(message, userId)] };
}

/** A user's own ticket list, most recent first. */
export async function listOwnTickets(userId: string): Promise<SupportTicket[]> {
  const rows = await findTicketsForUser(userId);
  return rows.map(toSupportTicket);
}

/** A user's own ticket detail, including every reply — but never an
 * admin-only internal note (listUserVisibleMessagesForTicket excludes
 * those at the query level). Same not-found-not-forbidden treatment as
 * every other "is this yours" check in this codebase: a ticket that
 * exists but belongs to someone else 404s exactly like one that
 * doesn't exist at all. */
export async function getOwnTicketDetail(userId: string, ticketId: string): Promise<SupportTicketDetail> {
  const ticket = await findTicketById(ticketId);
  if (!ticket || ticket.userId !== userId) {
    throw new NotFoundError('Support ticket not found');
  }

  const messageRows = await listUserVisibleMessagesForTicket(ticketId);
  return {
    ...toSupportTicket(ticket),
    messages: messageRows.map((row) => toSupportMessage(row, userId)),
  };
}
