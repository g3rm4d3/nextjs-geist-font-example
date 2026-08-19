import type { AdminSupportMessage, AdminSupportTicketDetail, AdminSupportTicketSummary } from '@rideshare/types';
import { changeSupportTicketStatusSchema, replySupportTicketSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminSupportService from '../services/adminSupportService';

export const adminSupportRouter = Router();

/** Section 14's "Support." */
adminSupportRouter.get(
  '/admin/support/tickets',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const tickets: AdminSupportTicketSummary[] = await adminSupportService.listSupportTickets();
    sendSuccess(req, res, tickets);
  },
);

/** "Inspect" a support ticket — the full message thread. */
adminSupportRouter.get(
  '/admin/support/tickets/:id',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const ticketId = requireIdParam(req.params.id, 'ticket id');
    const detail: AdminSupportTicketDetail = await adminSupportService.getSupportTicketDetail(ticketId);
    sendSuccess(req, res, detail);
  },
);

/**
 * Phase 16's minimal admin-reply endpoint — see
 * adminSupportService.replyToTicket's own comment on why this is scoped
 * to just enabling the "support update" notification event, not a full
 * Section 18 ticket lifecycle. ADMIN+ (not SUPER_ADMIN-only): a support
 * reply is a routine, reversible action, same classification as
 * approve/reject document review (Phase 14/15's ADMIN vs SUPER_ADMIN
 * split — see docs/admin-application.md).
 */
adminSupportRouter.post(
  '/admin/support/tickets/:id/messages',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  validateBody(replySupportTicketSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ticketId = requireIdParam(req.params.id, 'ticket id');
    const message: AdminSupportMessage = await adminSupportService.replyToTicket(
      ticketId,
      {
        userId: req.auth.userId,
        role: req.auth.role,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
      },
      req.body,
    );
    sendSuccess(req, res, message);
  },
);

/**
 * Section 18's "change status" — ADMIN+, same "routine, reversible
 * action" classification as reply (see replyToTicket route's own
 * comment on why this isn't SUPER_ADMIN-gated).
 */
adminSupportRouter.patch(
  '/admin/support/tickets/:id/status',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  validateBody(changeSupportTicketStatusSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ticketId = requireIdParam(req.params.id, 'ticket id');
    const ticket: AdminSupportTicketSummary = await adminSupportService.changeTicketStatus(
      ticketId,
      {
        userId: req.auth.userId,
        role: req.auth.role,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
      },
      req.body,
    );
    sendSuccess(req, res, ticket);
  },
);
