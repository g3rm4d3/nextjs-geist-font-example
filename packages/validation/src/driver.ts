import { z } from 'zod';

/**
 * Shared request-payload schemas for the driver-app's own profile
 * management (Phase 5). Server-side re-validation in apps/api is
 * authoritative, same as every other schema in this package — a client
 * passing this schema is never a substitute for that.
 */

/**
 * A driver may only ever request ONLINE or OFFLINE directly — BUSY is
 * set by the matching/dispatch system (a later phase), never chosen by
 * the driver themselves.
 */
export const updateAvailabilitySchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE']),
});
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

const nameSchema = z.string().trim().min(1, 'Required').max(100);

/**
 * Bounds mirror the CHECK constraints on the `vehicles` table
 * (packages/database/src/schema/vehicles.ts) — kept in sync by hand.
 */
export const upsertVehicleSchema = z.object({
  make: nameSchema,
  model: nameSchema,
  year: z.number().int().min(1980).max(2100),
  color: nameSchema,
  licensePlate: z.string().trim().min(1).max(32),
  vin: z.string().trim().min(1).max(17).optional(),
  seats: z.number().int().min(1).max(20),
});
export type UpsertVehicleInput = z.infer<typeof upsertVehicleSchema>;
