/**
 * Support ticket API contracts (Phase 18), owned by the ticket's own
 * user (passenger or driver) — distinct from `AdminSupportTicketSummary`/
 * `AdminSupportTicketDetail` (packages/types/src/admin.ts), which is the
 * admin-facing shape and includes admin-only internal notes. This
 * shape never can: `SupportMessage` has no `isInternalNote` field
 * because a user-facing message list is never given one to begin with
 * (see apps/api's supportService.getOwnTicketDetail).
 */
export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED';

/** One message in a ticket's thread, as the ticket's own owner sees it.
 * No author name/identity is exposed — `isFromSupport` is all a user
 * needs to tell their own message apart from a reply, and exposing an
 * admin's name/email here would be a needless identity leak (admin
 * accounts have no first/last name to show anyway — see
 * packages/database's users schema). */
export interface SupportMessage {
  id: string;
  body: string;
  isFromSupport: boolean;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: SupportTicketStatus;
  rideId: string | null;
  createdAt: string;
}

/** GET /support/tickets/:id. */
export interface SupportTicketDetail extends SupportTicket {
  messages: SupportMessage[];
}
