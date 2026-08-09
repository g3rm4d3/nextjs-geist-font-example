import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type DriverProfileRow = typeof schema.driverProfiles.$inferSelect;
export type VehicleRow = typeof schema.vehicles.$inferSelect;

export async function findActiveVehicleForDriver(
  driverId: string,
): Promise<VehicleRow | undefined> {
  const [vehicle] = await db
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.driverId, driverId), eq(schema.vehicles.isActive, true)))
    .limit(1);
  return vehicle;
}

export interface UpsertVehicleInput {
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  vin?: string | undefined;
  seats: number;
}

/**
 * A driver has at most one *active* vehicle at a time (enforced by
 * `vehicles_one_active_per_driver_key`, a partial unique index — see
 * packages/database/src/schema/vehicles.ts). Editing vehicle info in the
 * Vehicle screen updates that row in place rather than creating a new
 * one each time; a real "replace my vehicle" flow that keeps the old row
 * around for ride history is a later-phase concern, not Phase 5's.
 */
export async function upsertVehicleForDriver(
  driverId: string,
  input: UpsertVehicleInput,
): Promise<VehicleRow> {
  const existing = await findActiveVehicleForDriver(driverId);

  if (existing) {
    const [updated] = await db
      .update(schema.vehicles)
      .set({
        make: input.make,
        model: input.model,
        year: input.year,
        color: input.color,
        licensePlate: input.licensePlate,
        vin: input.vin ?? null,
        seats: input.seats,
        updatedAt: new Date(),
      })
      .where(eq(schema.vehicles.id, existing.id))
      .returning();
    if (!updated) throw new Error('Failed to update vehicle');
    return updated;
  }

  const [created] = await db
    .insert(schema.vehicles)
    .values({
      driverId,
      make: input.make,
      model: input.model,
      year: input.year,
      color: input.color,
      licensePlate: input.licensePlate,
      vin: input.vin ?? null,
      seats: input.seats,
      isActive: true,
    })
    .returning();
  if (!created) throw new Error('Failed to create vehicle');
  return created;
}

export async function updateDriverAvailability(
  driverId: string,
  status: 'ONLINE' | 'OFFLINE',
): Promise<DriverProfileRow> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ availabilityStatus: status, updatedAt: new Date() })
    .where(eq(schema.driverProfiles.id, driverId))
    .returning();
  if (!updated) throw new Error('Failed to update driver availability');
  return updated;
}

/**
 * DRAFT -> PENDING_REVIEW only. Every other transition (approve, reject,
 * suspend, reactivate) is an admin action that belongs to Phase 14, not
 * something a driver can trigger on themselves.
 */
export async function submitDriverApplication(driverId: string): Promise<DriverProfileRow> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'PENDING_REVIEW', updatedAt: new Date() })
    .where(and(eq(schema.driverProfiles.id, driverId), eq(schema.driverProfiles.onboardingStatus, 'DRAFT')))
    .returning();
  if (!updated) throw new Error('Failed to submit driver application');
  return updated;
}
