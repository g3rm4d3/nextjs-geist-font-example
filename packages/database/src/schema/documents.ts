import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { documentReviewStatusEnum, documentTypeEnum } from './enums';
import { driverProfiles } from './drivers';
import { users } from './users';

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driverProfiles.id, { onDelete: 'cascade' }),
    documentType: documentTypeEnum('document_type').notNull(),
    // Opaque reference into the storage provider (Phase 15's
    // StorageProvider abstraction); never a raw filesystem path.
    storageKey: text('storage_key').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reviewStatus: documentReviewStatusEnum('review_status').notNull().default('PENDING'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (table) => [
    index('driver_documents_driver_id_idx').on(table.driverId),
    index('driver_documents_review_status_idx').on(table.reviewStatus),
    index('driver_documents_expires_at_idx').on(table.expiresAt),
  ],
);
