import type { AdminDocumentSummary } from '@rideshare/types';
import { requestDocumentReplacementSchema, reviewDocumentSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminDocumentService from '../services/adminDocumentService';

export const adminDocumentsRouter = Router();

const REVIEW_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED', 'REPLACEMENT_REQUESTED'];

/**
 * Section 14's "Documents" review queue. `?reviewStatus=PENDING` (the
 * default an admin-app landing on this page would use) narrows to the
 * actual queue; omitted shows every document ever uploaded.
 * `?expiringWithinDays=N` (Phase 15) is the "internal expiration
 * warnings" filter — both filters can combine, e.g.
 * `?reviewStatus=APPROVED&expiringWithinDays=30`.
 */
adminDocumentsRouter.get(
  '/admin/documents',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const statusParam = req.query.reviewStatus;
    if (statusParam !== undefined) {
      if (typeof statusParam !== 'string' || !REVIEW_STATUS_VALUES.includes(statusParam)) {
        throw new ValidationError('Invalid reviewStatus filter');
      }
    }

    const expiringParam = req.query.expiringWithinDays;
    let expiringWithinDays: number | undefined;
    if (expiringParam !== undefined) {
      if (typeof expiringParam !== 'string' || !/^\d+$/.test(expiringParam)) {
        throw new ValidationError('Invalid expiringWithinDays filter');
      }
      expiringWithinDays = Number(expiringParam);
    }

    const documents: AdminDocumentSummary[] = await adminDocumentService.listDocumentsForAdmin({
      reviewStatus: statusParam as AdminDocumentSummary['reviewStatus'] | undefined,
      expiringWithinDays,
    });
    sendSuccess(req, res, documents);
  },
);

/** "Review documents." PENDING -> APPROVED/REJECTED only — see
 * documentsRepository.reviewDocument's own comment on the underlying
 * compare-and-swap. */
adminDocumentsRouter.post(
  '/admin/documents/:id/review',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  validateBody(reviewDocumentSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const documentId = requireIdParam(req.params.id, 'document id');
    const document: AdminDocumentSummary = await adminDocumentService.reviewDocument(
      documentId,
      {
        userId: req.auth.userId,
        role: req.auth.role,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
      },
      req.body.approved,
      req.body.rejectionReason ?? null,
    );
    sendSuccess(req, res, document);
  },
);

/** "Request replacement" (section 15's third admin document action) —
 * PENDING or APPROVED -> REPLACEMENT_REQUESTED only. */
adminDocumentsRouter.post(
  '/admin/documents/:id/request-replacement',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  validateBody(requestDocumentReplacementSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const documentId = requireIdParam(req.params.id, 'document id');
    const document: AdminDocumentSummary = await adminDocumentService.requestReplacement(
      documentId,
      {
        userId: req.auth.userId,
        role: req.auth.role,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
      },
      req.body.reason,
    );
    sendSuccess(req, res, document);
  },
);
