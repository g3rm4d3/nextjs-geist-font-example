/**
 * Driver document API contracts (Phase 15), shared by apps/api (producer)
 * and apps/driver-app / apps/admin-app (consumers).
 */

export type DocumentType = 'DRIVER_LICENSE' | 'VEHICLE_REGISTRATION' | 'INSURANCE' | 'PROFILE_PHOTO';

/** REPLACEMENT_REQUESTED is distinct from REJECTED — the document isn't
 * being turned down outright, it just needs a fresh upload (e.g. it's
 * about to expire, or the photo needs to be retaken). */
export type DocumentReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REPLACEMENT_REQUESTED';

/** A driver's own view of one of their uploaded documents. */
export interface DriverDocument {
  id: string;
  documentType: DocumentType;
  uploadedAt: string;
  expiresAt: string | null;
  reviewStatus: DocumentReviewStatus;
  reviewedAt: string | null;
  /** Populated for both REJECTED and REPLACEMENT_REQUESTED — the same
   * "here's why" note either way. */
  rejectionReason: string | null;
}

export interface UploadDocumentInput {
  documentType: DocumentType;
  /** Base64-encoded file bytes — see @rideshare/storage's StoreFileInput. */
  contentBase64: string;
  contentType: string;
  /** ISO 8601. Optional — a Profile Photo, for instance, doesn't expire. */
  expiresAt?: string;
}

export type BackgroundCheckStatus = 'PENDING' | 'PASSED' | 'FAILED';

/** An admin's view of a driver's most recent background check. */
export interface BackgroundCheckSummary {
  id: string;
  status: BackgroundCheckStatus;
  requestedAt: string;
  completedAt: string | null;
}
