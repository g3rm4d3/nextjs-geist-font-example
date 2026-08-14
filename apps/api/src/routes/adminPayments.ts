import type { AdminPaymentDetail, AdminPaymentSummary } from '@rideshare/types';
import { Router } from 'express';
import { ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminPaymentService from '../services/adminPaymentService';

export const adminPaymentsRouter = Router();

const PAYMENT_STATUS_VALUES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'];

/** Section 14's "Payments" — every payment attempt across every ride. */
adminPaymentsRouter.get(
  '/admin/payments',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const statusParam = req.query.status;
    if (statusParam !== undefined) {
      if (typeof statusParam !== 'string' || !PAYMENT_STATUS_VALUES.includes(statusParam)) {
        throw new ValidationError('Invalid status filter');
      }
    }
    const payments: AdminPaymentSummary[] = await adminPaymentService.listPayments(
      statusParam as AdminPaymentSummary['status'] | undefined,
    );
    sendSuccess(req, res, payments);
  },
);

/** "Inspect payment." */
adminPaymentsRouter.get(
  '/admin/payments/:id',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const paymentId = requireIdParam(req.params.id, 'payment id');
    const detail: AdminPaymentDetail = await adminPaymentService.getPaymentDetail(paymentId);
    sendSuccess(req, res, detail);
  },
);
