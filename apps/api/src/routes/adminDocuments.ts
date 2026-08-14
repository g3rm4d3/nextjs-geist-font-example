import type { AdminDocumentSummary } from '@rideshare/types';
import { reviewDocumentSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminDocumentService from '../services/adminDocumentService';

export const adminDocumentsRouter = Router();

const REVIEW_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED'];

/** Section 14's "Documents" review queue. `?reviewStatus=PENDING` (the
 * default an admin-app landing on this page would use) narrows to the
 * actual queue; omitted shows every document ever uploaded. */
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
    const documents: AdminDocumentSummary[] = await adminDocumentService.listDocumentsForAdmin(
      statusParam as AdminDocumentSummary['reviewStatus'] | undefined,
    );
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
