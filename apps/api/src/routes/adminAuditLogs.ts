import type { AdminAuditLogEntry } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { getAuditLogs } from '../services/auditService';

export const adminAuditLogsRouter = Router();

/**
 * Section 14's "Audit Logs" — SUPER_ADMIN only. The audit trail itself
 * is one of the things a plain ADMIN shouldn't be able to browse (it
 * includes every other admin's sensitive actions, including SUPER_ADMIN
 * ones), so this is stricter than the "inspect" routes elsewhere in this
 * phase.
 */
adminAuditLogsRouter.get(
  '/admin/audit-logs',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const entries: AdminAuditLogEntry[] = await getAuditLogs();
    sendSuccess(req, res, entries);
  },
);
