import type { AdminSupportTicketDetail, AdminSupportTicketSummary } from '@rideshare/types';
import { Router } from 'express';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
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
