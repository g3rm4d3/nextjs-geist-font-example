import type { DocumentType, DriverDocument, UploadDocumentInput } from '@rideshare/types';
import { storageProvider } from '../lib/storageProvider';
import {
  createDocument,
  findDocumentsByDriver,
  type DriverDocumentRow,
} from '../repositories/documentsRepository';
import { findDriverProfileByUserId } from '../repositories/usersRepository';

function toDriverDocument(row: DriverDocumentRow): DriverDocument {
  return {
    id: row.id,
    documentType: row.documentType,
    uploadedAt: row.uploadedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
  };
}

async function requireDriverProfileId(userId: string): Promise<string> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');
  return profile.id;
}

const KEY_PREFIX_BY_TYPE: Record<DocumentType, string> = {
  DRIVER_LICENSE: 'driver-documents/driver-license',
  VEHICLE_REGISTRATION: 'driver-documents/vehicle-registration',
  INSURANCE: 'driver-documents/insurance',
  PROFILE_PHOTO: 'driver-documents/profile-photo',
};

/**
 * Section 15: "Implement secure document system" — a driver's own
 * upload. The file itself goes through @rideshare/storage's
 * StorageProvider (never a raw path persisted directly), and only the
 * opaque storageKey it returns is written to driver_documents. Always
 * inserts a new row, PENDING, regardless of any prior document of the
 * same type — see documentsRepository.createDocument for why nothing
 * here supersedes or deletes an earlier upload.
 */
export async function uploadDocument(
  userId: string,
  input: UploadDocumentInput,
): Promise<DriverDocument> {
  const driverId = await requireDriverProfileId(userId);

  const { storageKey } = await storageProvider.store({
    contentBase64: input.contentBase64,
    contentType: input.contentType,
    keyPrefix: KEY_PREFIX_BY_TYPE[input.documentType],
  });

  const row = await createDocument({
    driverId,
    documentType: input.documentType,
    storageKey,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  });

  return toDriverDocument(row);
}

/** A driver's own document list — every document they've ever
 * uploaded, most recent first, whatever its review status. */
export async function listOwnDocuments(userId: string): Promise<DriverDocument[]> {
  const driverId = await requireDriverProfileId(userId);
  const rows = await findDocumentsByDriver(driverId);
  return rows.map(toDriverDocument);
}
