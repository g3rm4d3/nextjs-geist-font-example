import type { DriverDocument } from '@rideshare/types';
import { uploadDocumentSchema } from '@rideshare/validation';
import { Router } from 'express';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { documentLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as documentService from '../services/documentService';

export const driverDocumentsRouter = Router();

/** Section 15: "Implement secure document system" — a driver uploads a
 * new document. Always 201s a new PENDING row; see documentService's
 * own comment on why nothing here supersedes an earlier upload. */
driverDocumentsRouter.post(
  '/drivers/me/documents',
  requireAuth,
  requireRole('DRIVER'),
  documentLimiter,
  validateBody(uploadDocumentSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const document: DriverDocument = await documentService.uploadDocument(req.auth.userId, req.body);
    sendSuccess(req, res, document, 201);
  },
);

/** A driver's own document list. */
driverDocumentsRouter.get(
  '/drivers/me/documents',
  requireAuth,
  requireRole('DRIVER'),
  documentLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const documents: DriverDocument[] = await documentService.listOwnDocuments(req.auth.userId);
    sendSuccess(req, res, documents);
  },
);
