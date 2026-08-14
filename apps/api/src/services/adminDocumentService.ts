import type { AdminDocumentSummary } from '@rideshare/types';
import type { AuditActorContext } from '../lib/auditContext';
import { ConflictError, NotFoundError } from '../lib/errors';
import {
  findDocumentById,
  listDocuments,
  reviewDocument as reviewDocumentRow,
  type DocumentAdminRow,
} from '../repositories/documentsRepository';
import { findDriverProfileById } from '../repositories/usersRepository';
import { recordAuditLog } from './auditService';

function toSummary(row: DocumentAdminRow): AdminDocumentSummary {
  return {
    id: row.id,
    driverId: row.driverId,
    driverName: `${row.driverFirstName} ${row.driverLastName}`,
    documentType: row.documentType,
    reviewStatus: row.reviewStatus,
    uploadedAt: row.uploadedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
  };
}

type DocumentReviewStatus = AdminDocumentSummary['reviewStatus'];

/** Section 14's "Documents" review queue. `reviewStatus` omitted shows
 * every document ever uploaded, not just the pending ones. */
export async function listDocumentsForAdmin(
  reviewStatus?: DocumentReviewStatus,
): Promise<AdminDocumentSummary[]> {
  const rows = await listDocuments(reviewStatus);
  return rows.map(toSummary);
}

/** "Review documents": approve outright, or reject with a required
 * reason (@rideshare/validation's reviewDocumentSchema enforces that
 * split client-side; ratingsService-style server-side re-checks aren't
 * needed here since there's no state to double-validate beyond what the
 * schema already guarantees). PENDING -> APPROVED/REJECTED only — a 409
 * if this document was already reviewed. */
export async function reviewDocument(
  documentId: string,
  actor: AuditActorContext,
  approved: boolean,
  rejectionReason: string | null,
): Promise<AdminDocumentSummary> {
  const updated = await reviewDocumentRow({
    documentId,
    reviewerUserId: actor.userId,
    approved,
    rejectionReason,
  });
  if (!updated) {
    const existing = await findDocumentById(documentId);
    if (!existing) throw new NotFoundError('Document not found');
    throw new ConflictError('This document has already been reviewed');
  }

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: approved ? 'document.approve' : 'document.reject',
    entityType: 'driver_document',
    entityId: documentId,
    before: { reviewStatus: 'PENDING' },
    after: { reviewStatus: updated.reviewStatus, rejectionReason: updated.rejectionReason },
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  const driver = await findDriverProfileById(updated.driverId);
  const driverName = driver ? `${driver.firstName} ${driver.lastName}` : 'Unknown driver';

  return {
    id: updated.id,
    driverId: updated.driverId,
    driverName,
    documentType: updated.documentType,
    reviewStatus: updated.reviewStatus,
    uploadedAt: updated.uploadedAt.toISOString(),
    expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
    reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
    rejectionReason: updated.rejectionReason,
  };
}
