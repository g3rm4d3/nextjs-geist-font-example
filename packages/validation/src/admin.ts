import { z } from 'zod';

/**
 * Shared request-payload schemas for admin-app's moderation and
 * platform-configuration actions (Phase 14). Server-side re-validation
 * in apps/api is authoritative, same as every other schema in this
 * package.
 */

/** POST /admin/drivers/:id/reject — a reason is required (unlike
 * ride cancellation's optional one): a rejection is a one-directional
 * gate the driver can't self-resubmit past without knowing why. */
export const rejectDriverSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectDriverInput = z.infer<typeof rejectDriverSchema>;

/** POST /admin/drivers/:id/suspend (SUPER_ADMIN only). */
export const suspendDriverSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type SuspendDriverInput = z.infer<typeof suspendDriverSchema>;

/** POST /admin/documents/:id/review — either approves outright, or
 * rejects with a reason (required only when rejecting, enforced by the
 * refine below rather than two separate endpoints). */
export const reviewDocumentSchema = z
  .object({
    approved: z.boolean(),
    rejectionReason: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => value.approved || !!value.rejectionReason, {
    message: 'rejectionReason is required when rejecting a document',
    path: ['rejectionReason'],
  });
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;

/** POST /admin/documents/:id/request-replacement — the document isn't
 * being rejected outright, it just needs a fresh upload; a reason is
 * required so the driver knows what to fix, same as reject. */
export const requestDocumentReplacementSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RequestDocumentReplacementInput = z.infer<typeof requestDocumentReplacementSchema>;

/**
 * POST /admin/pricing/configs (SUPER_ADMIN only) — "change pricing."
 * Bounds mirror the CHECK constraints on `pricing_configs`
 * (packages/database/src/schema/pricingConfigs.ts). Creates a new named
 * config and makes it the active one; it never mutates an existing row
 * in place, so pricing history stays intact.
 */
export const changePricingSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseFareCents: z.number().int().min(0),
  perMileRateCents: z.number().int().min(0),
  perMinuteRateCents: z.number().int().min(0),
  minimumFareCents: z.number().int().min(0),
  bookingFeeCents: z.number().int().min(0),
  cancellationFeeCents: z.number().int().min(0),
  platformCommissionPercentage: z.number().min(0).max(100),
});
export type ChangePricingInput = z.infer<typeof changePricingSchema>;

/** PUT /admin/settings/:key (SUPER_ADMIN only). `value` is deliberately
 * `z.unknown()` — system_settings.value is a generic jsonb column
 * (packages/database/src/schema/systemSettings.ts), not a fixed shape. */
export const upsertSystemSettingSchema = z.object({
  value: z.unknown(),
  description: z.string().trim().min(1).max(500).optional(),
});
export type UpsertSystemSettingInput = z.infer<typeof upsertSystemSettingSchema>;

/** POST /admin/support/tickets/:id/messages — an admin's reply to a
 * support ticket. Section 16's "support update" notification fires only
 * for a non-internal-note reply (an internal note is never visible to
 * the ticket's owner, so there's nothing to notify them about). */
export const replySupportTicketSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  isInternalNote: z.boolean().optional(),
});
export type ReplySupportTicketInput = z.infer<typeof replySupportTicketSchema>;
