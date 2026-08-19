import type { SupportTicket, SupportTicketDetail } from '@rideshare/types';
import { createSupportTicketSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { supportLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as supportService from '../services/supportService';

export const supportRouter = Router();

/** Section 18: "Passenger App and Driver App: create support ticket.
 * Ticket can reference ride." Shared by both apps/roles — there's
 * nothing role-specific about opening a ticket, and `rideId` ownership
 * (as either a passenger or a driver) is enforced server-side either
 * way (see supportService.createTicket). `201` with the full detail
 * (including the caller's own opening message) so the client can
 * render the new ticket immediately without a second round-trip. */
supportRouter.post(
  '/support/tickets',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  supportLimiter,
  validateBody(createSupportTicketSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ticket: SupportTicketDetail = await supportService.createTicket(req.auth.userId, req.body);
    sendSuccess(req, res, ticket, 201);
  },
);

/** A user's own ticket list, most recent first. */
supportRouter.get(
  '/support/tickets',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  supportLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const tickets: SupportTicket[] = await supportService.listOwnTickets(req.auth.userId);
    sendSuccess(req, res, tickets);
  },
);

/** A user's own ticket detail, including every reply (never an
 * admin-only internal note) — 404 for an unknown id or one that
 * belongs to someone else, same not-found-not-forbidden treatment as
 * every other "is this yours" check in this codebase. */
supportRouter.get(
  '/support/tickets/:id',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  supportLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ticketId = requireIdParam(req.params.id, 'ticket id');
    const ticket: SupportTicketDetail = await supportService.getOwnTicketDetail(req.auth.userId, ticketId);
    sendSuccess(req, res, ticket);
  },
);
