import { schema } from '@rideshare/database';
import { and, count, desc, eq } from 'drizzle-orm';
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

export interface DocumentAdminRow extends DriverDocumentRow {
  driverFirstName: string;
  driverLastName: string;
}

/** Section 14's "Documents" review queue. `reviewStatus` omitted means
 * every document, not just PENDING — an admin re-checking an already-
 * reviewed document (e.g. after a dispute) still needs to find it. */
export async function listDocuments(
  reviewStatus?: DocumentReviewStatusValue,
): Promise<DocumentAdminRow[]> {
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
    .where(reviewStatus ? eq(schema.driverDocuments.reviewStatus, reviewStatus) : undefined)
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
