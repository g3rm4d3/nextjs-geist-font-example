import type { AdminDocumentSummary } from '@rideshare/types';
import type { AuditActorContext } from '../lib/auditContext';
import { ConflictError, NotFoundError } from '../lib/errors';
import {
  findDocumentById,
  listDocuments,
  requestReplacement as requestReplacementRow,
  reviewDocument as reviewDocumentRow,
  type DocumentAdminRow,
  type DriverDocumentRow,
  type ListDocumentsFilter,
} from '../repositories/documentsRepository';
import { findDriverProfileById } from '../repositories/usersRepository';
import { recordAuditLog } from './auditService';

function toSummary(row: DocumentAdminRow): AdminDocumentSummary {
  return buildSummary(row, `${row.driverFirstName} ${row.driverLastName}`);
}

function buildSummary(row: DriverDocumentRow, driverName: string): AdminDocumentSummary {
  return {
    id: row.id,
    driverId: row.driverId,
    driverName,
    documentType: row.documentType,
    reviewStatus: row.reviewStatus,
    uploadedAt: row.uploadedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
  };
}

async function driverNameFor(driverId: string): Promise<string> {
  const driver = await findDriverProfileById(driverId);
  return driver ? `${driver.firstName} ${driver.lastName}` : 'Unknown driver';
}

/** Section 14's "Documents" review queue, extended in Phase 15 with an
 * expiration filter. Both filters omitted shows every document ever
 * uploaded, not just the pending ones. */
export async function listDocumentsForAdmin(filter: ListDocumentsFilter = {}): Promise<AdminDocumentSummary[]> {
  const rows = await listDocuments(filter);
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

  return buildSummary(updated, await driverNameFor(updated.driverId));
}

/**
 * "Request replacement" — the third admin document action (section 15),
 * distinct from reject: the document isn't being turned down outright,
 * it just needs a fresh upload. PENDING or APPROVED -> REPLACEMENT_REQUESTED
 * only — a 409 if the document is already REJECTED or already has a
 * pending replacement request.
 */
export async function requestReplacement(
  documentId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<AdminDocumentSummary> {
  // Captured before the compare-and-swap purely for an accurate audit
  // "before" snapshot — requestReplacementRow allows two starting
  // states (PENDING or APPROVED), so there's no single hardcoded value
  // to record the way suspendDriver's audit entry can.
  const before = await findDocumentById(documentId);

  const updated = await requestReplacementRow({
    documentId,
    reviewerUserId: actor.userId,
    reason,
  });
  if (!updated) {
    if (!before) throw new NotFoundError('Document not found');
    throw new ConflictError('A replacement cannot be requested for this document in its current state');
  }

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'document.request_replacement',
    entityType: 'driver_document',
    entityId: documentId,
    before: { reviewStatus: before?.reviewStatus },
    after: { reviewStatus: 'REPLACEMENT_REQUESTED', reason },
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  return buildSummary(updated, await driverNameFor(updated.driverId));
}
