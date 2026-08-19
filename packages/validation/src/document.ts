import { z } from 'zod';

/**
 * Phase 20 (security review): every real document this endpoint is
 * meant for — a photographed license/registration/insurance page, a
 * profile photo — is one of these. An unconstrained `contentType`
 * string (the original Phase 15 shape) gets stored and, if a future
 * phase ever wires StorageProvider.getUrl() up to a client (it isn't
 * today — see docs/security.md), would come back out verbatim in a
 * `data:${contentType};base64,...` URI; restricting it here means that
 * URI can never be coerced into `data:text/html;...` or similar. Fixed
 * defensively even though no current code path reaches getUrl().
 */
const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

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
  contentType: z.enum(ALLOWED_DOCUMENT_CONTENT_TYPES),
  expiresAt: z.string().datetime().optional(),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
