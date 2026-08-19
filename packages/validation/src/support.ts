import { z } from 'zod';

/**
 * POST /support/tickets — "Passenger App and Driver App: create support
 * ticket. Ticket can reference ride." `rideId`, when present, is
 * server-verified to actually belong to the calling user (as either
 * its passenger or its driver) — see apps/api's supportService.createTicket
 * — never trusted as-is from the client.
 */
export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  rideId: z.uuid().optional(),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

/** PATCH /admin/support/tickets/:id/status — the five states section 18
 * itself enumerates. Unlike a ride's forward-only lifecycle, a support
 * ticket has no fixed transition graph in the spec — any status can
 * move to any other (e.g. RESOLVED reopened back to IN_PROGRESS), so
 * this is a plain enum, not a compare-and-swap allow-list. */
export const changeSupportTicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']),
});
export type ChangeSupportTicketStatusInput = z.infer<typeof changeSupportTicketStatusSchema>;
