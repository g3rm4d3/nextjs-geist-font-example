import { schema } from '@rideshare/database';
import { and, count, desc, eq, inArray, lte } from 'drizzle-orm';
import { db } from '../db/client';

export type DriverDocumentRow = typeof schema.driverDocuments.$inferSelect;
type DocumentReviewStatusValue = DriverDocumentRow['reviewStatus'];

/** Section 15's document schema (already fully defined) — this phase is
 * the first to read/write it. One row per driver-uploaded document. */
export async function findDocumentsByDriver(driverId: string): Promise<DriverDocumentRow[]> {
  return db
    .select()
    .from(schema.driverDocuments)
    .where(eq(schema.driverDocuments.driverId, driverId))
    .orderBy(desc(schema.driverDocuments.uploadedAt));
}

export async function findDocumentById(documentId: string): Promise<DriverDocumentRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.driverDocuments)
    .where(eq(schema.driverDocuments.id, documentId))
    .limit(1);
  return row;
}

export interface CreateDocumentInput {
  driverId: string;
  documentType: DriverDocumentRow['documentType'];
  storageKey: string;
  expiresAt: Date | null;
}

/** "Upload document" — always starts PENDING (the column default),
 * regardless of any prior document of the same type: nothing here
 * supersedes or deletes an earlier upload, so a driver's full document
 * history stays intact for an admin to review. */
export async function createDocument(input: CreateDocumentInput): Promise<DriverDocumentRow> {
  const [row] = await db
    .insert(schema.driverDocuments)
    .values({
      driverId: input.driverId,
      documentType: input.documentType,
      storageKey: input.storageKey,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error('Failed to insert driver document');
  return row;
}

export interface DocumentAdminRow extends DriverDocumentRow {
  driverFirstName: string;
  driverLastName: string;
}

export interface ListDocumentsFilter {
  reviewStatus?: DocumentReviewStatusValue;
  /** Section 15's "internal expiration warnings": only documents
   * expiring at or before now + N days (an already-expired document
   * counts too — it needs even more urgent attention, not less). Only
   * an APPROVED document is "in service" with an operationally relevant
   * expiration, so this implies reviewStatus = APPROVED unless the
   * caller explicitly overrides it — the same restriction
   * countExpiringDocuments (the dashboard's count) applies, so the
   * number an admin sees on the dashboard matches what this filter
   * shows them when they click through. */
  expiringWithinDays?: number;
}

/** Section 14's "Documents" review queue, extended in Phase 15 with an
 * expiration filter. Both filters omitted means every document, not
 * just PENDING — an admin re-checking an already-reviewed document
 * (e.g. after a dispute) still needs to find it. */
export async function listDocuments(filter: ListDocumentsFilter = {}): Promise<DocumentAdminRow[]> {
  const conditions = [];
  if (filter.reviewStatus) {
    conditions.push(eq(schema.driverDocuments.reviewStatus, filter.reviewStatus));
  } else if (filter.expiringWithinDays !== undefined) {
    conditions.push(eq(schema.driverDocuments.reviewStatus, 'APPROVED'));
  }
  if (filter.expiringWithinDays !== undefined) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + filter.expiringWithinDays);
    conditions.push(lte(schema.driverDocuments.expiresAt, threshold));
  }

  return db
    .select({
      id: schema.driverDocuments.id,
      driverId: schema.driverDocuments.driverId,
      documentType: schema.driverDocuments.documentType,
      storageKey: schema.driverDocuments.storageKey,
      uploadedAt: schema.driverDocuments.uploadedAt,
      expiresAt: schema.driverDocuments.expiresAt,
      reviewStatus: schema.driverDocuments.reviewStatus,
      reviewedBy: schema.driverDocuments.reviewedBy,
      reviewedAt: schema.driverDocuments.reviewedAt,
      rejectionReason: schema.driverDocuments.rejectionReason,
      createdAt: schema.driverDocuments.createdAt,
      updatedAt: schema.driverDocuments.updatedAt,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
    })
    .from(schema.driverDocuments)
    .innerJoin(schema.driverProfiles, eq(schema.driverDocuments.driverId, schema.driverProfiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.driverDocuments.uploadedAt));
}

/** Section 14's "Dashboard": documents awaiting review. */
export async function countPendingDocuments(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.driverDocuments)
    .where(eq(schema.driverDocuments.reviewStatus, 'PENDING'));
  return row?.total ?? 0;
}

const EXPIRATION_WARNING_WINDOW_DAYS = 30;

/** Section 15's "internal expiration warnings": APPROVED documents
 * expiring within the window (or already expired) — a REJECTED/
 * REPLACEMENT_REQUESTED/PENDING document isn't "in service" so its
 * expiration date isn't operationally relevant yet. */
export async function countExpiringDocuments(
  withinDays: number = EXPIRATION_WARNING_WINDOW_DAYS,
): Promise<number> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + withinDays);

  const [row] = await db
    .select({ total: count() })
    .from(schema.driverDocuments)
    .where(
      and(eq(schema.driverDocuments.reviewStatus, 'APPROVED'), lte(schema.driverDocuments.expiresAt, threshold)),
    );
  return row?.total ?? 0;
}

export interface ReviewDocumentResultInput {
  documentId: string;
  reviewerUserId: string;
  approved: boolean;
  rejectionReason: string | null;
}

/** "Review documents" — a compare-and-swap from PENDING only, the same
 * pattern every other state transition in this codebase uses. A
 * document already APPROVED/REJECTED can't be silently re-reviewed out
 * from under whoever looked at it first. */
export async function reviewDocument(
  input: ReviewDocumentResultInput,
): Promise<DriverDocumentRow | undefined> {
  const [updated] = await db
    .update(schema.driverDocuments)
    .set({
      reviewStatus: input.approved ? 'APPROVED' : 'REJECTED',
      reviewedBy: input.reviewerUserId,
      reviewedAt: new Date(),
      rejectionReason: input.approved ? null : input.rejectionReason,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.driverDocuments.id, input.documentId), eq(schema.driverDocuments.reviewStatus, 'PENDING')),
    )
    .returning();
  return updated;
}

export interface RequestReplacementInput {
  documentId: string;
  reviewerUserId: string;
  reason: string;
}

/**
 * "Request replacement" — distinct from reject: the document isn't
 * being turned down outright, it just needs a fresh upload (e.g. it's
 * fine but about to expire, or the photo needs to be retaken).
 * PENDING or APPROVED -> REPLACEMENT_REQUESTED only, the same compare-
 * and-swap shape as reviewDocument — an already-REJECTED or already-
 * REPLACEMENT_REQUESTED document can't be re-flagged out from under an
 * existing decision.
 */
export async function requestReplacement(
  input: RequestReplacementInput,
): Promise<DriverDocumentRow | undefined> {
  const [updated] = await db
    .update(schema.driverDocuments)
    .set({
      reviewStatus: 'REPLACEMENT_REQUESTED',
      reviewedBy: input.reviewerUserId,
      reviewedAt: new Date(),
      rejectionReason: input.reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.driverDocuments.id, input.documentId),
        inArray(schema.driverDocuments.reviewStatus, ['PENDING', 'APPROVED']),
      ),
    )
    .returning();
  return updated;
}
