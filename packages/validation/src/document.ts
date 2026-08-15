import { z } from 'zod';

/**
 * POST /drivers/me/documents (Phase 15). `contentBase64` is decoded and
 * handed to @rideshare/storage's StorageProvider server-side — the
 * regex check here is just an early, friendly reject for obviously
 * malformed input, not a substitute for the storage layer's own
 * handling. `expiresAt` is optional: a Profile Photo, for instance,
 * doesn't expire.
 */
export const uploadDocumentSchema = z.object({
  documentType: z.enum(['DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'PROFILE_PHOTO']),
  contentBase64: z
    .string()
    .min(1)
    .max(6_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'contentBase64 must be valid base64'),
  contentType: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
