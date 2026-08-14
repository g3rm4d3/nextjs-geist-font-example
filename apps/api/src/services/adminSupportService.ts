import type { AdminSupportMessage, AdminSupportTicketDetail, AdminSupportTicketSummary } from '@rideshare/types';
import { NotFoundError } from '../lib/errors';
import {
  findTicketAdminRowById,
  listMessagesForTicket,
  listTickets,
  type SupportTicketAdminRow,
} from '../repositories/supportRepository';

function userName(row: {
  passengerFirstName: string | null;
  passengerLastName: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
}): string {
  const firstName = row.passengerFirstName ?? row.driverFirstName;
  const lastName = row.passengerLastName ?? row.driverLastName;
  return firstName && lastName ? `${firstName} ${lastName}` : 'Unknown user';
}

function toSummary(row: SupportTicketAdminRow): AdminSupportTicketSummary {
  return {
    id: row.id,
    userName: userName(row),
    subject: row.subject,
    status: row.status,
    rideId: row.rideId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Section 14's "Support." Section 18 (not yet built) is what will let a
 * passenger/driver actually open a ticket — this phase only adds the
 * admin-facing read side, real and functional against whatever rows
 * exist (currently none, since nothing writes to support_tickets yet).
 */
export async function listSupportTickets(): Promise<AdminSupportTicketSummary[]> {
  const rows = await listTickets();
  return rows.map(toSummary);
}

/** "Inspect" a ticket — the full message thread, oldest first, including
 * admin-only internal notes (support_messages.is_internal_note). */
export async function getSupportTicketDetail(ticketId: string): Promise<AdminSupportTicketDetail> {
  const row = await findTicketAdminRowById(ticketId);
  if (!row) throw new NotFoundError('Support ticket not found');

  const messageRows = await listMessagesForTicket(ticketId);
  const messages: AdminSupportMessage[] = messageRows.map((message) => ({
    id: message.id,
    authorName:
      message.authorFirstName && message.authorLastName
        ? `${message.authorFirstName} ${message.authorLastName}`
        : null,
    isInternalNote: message.isInternalNote,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  }));

  return { ...toSummary(row), messages };
}
