import type { AdminSupportMessage, AdminSupportTicketDetail, AdminSupportTicketSummary } from '@rideshare/types';
import type { ReplySupportTicketInput } from '@rideshare/validation';
import type { AuditActorContext } from '../lib/auditContext';
import { NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import {
  createMessage,
  findTicketAdminRowById,
  listMessagesForTicket,
  listTickets,
  type SupportTicketAdminRow,
} from '../repositories/supportRepository';
import { findUserById } from '../repositories/usersRepository';
import { recordAuditLog } from './auditService';
import { notifySupportUpdate } from './notificationService';

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

/**
 * POST /admin/support/tickets/:id/messages — deliberately the *only*
 * write this phase adds to support_tickets/support_messages: enough for
 * Phase 16's "support update" notification event to have a genuine
 * trigger, not a reimplementation of Section 18's full ticket lifecycle
 * (no ticket creation, no status transitions, no passenger/driver-facing
 * reply UI — those stay Section 18's job). An internal note
 * (isInternalNote) is never visible to the ticket's owner, so it fires
 * no notification; a real reply does, best-effort, same "must not fail
 * the primary action" precedent as every other notification trigger in
 * this codebase.
 *
 * Also audited (Section 14's "sensitive admin operations generate
 * audit records") — every other mutating admin action in this codebase
 * (approve/reject/suspend, document review, background checks, pricing/
 * settings writes) records an audit entry, and a support reply is no
 * less a mutating admin action than those.
 */
export async function replyToTicket(
  ticketId: string,
  actor: AuditActorContext,
  input: ReplySupportTicketInput,
): Promise<AdminSupportMessage> {
  const ticket = await findTicketAdminRowById(ticketId);
  if (!ticket) throw new NotFoundError('Support ticket not found');

  const message = await createMessage({
    ticketId,
    authorUserId: actor.userId,
    isInternalNote: input.isInternalNote ?? false,
    body: input.body,
  });

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'support.reply',
    entityType: 'support_ticket',
    entityId: ticketId,
    before: null,
    after: { messageId: message.id, isInternalNote: message.isInternalNote },
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  if (!message.isInternalNote) {
    try {
      const owner = await findUserById(ticket.userId);
      if (owner) {
        await notifySupportUpdate(owner.id, ticketId);
      }
    } catch (notificationError) {
      logger.error(
        { err: notificationError, ticketId },
        'Failed to send support-update notification',
      );
    }
  }

  // ADMIN/SUPER_ADMIN accounts have no passenger/driver profile (and so
  // no first/last name — see packages/database/src/schema/users.ts) —
  // their email is the only identifying label available here.
  const admin = await findUserById(actor.userId);
  return {
    id: message.id,
    authorName: admin ? admin.email : null,
    isInternalNote: message.isInternalNote,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}
