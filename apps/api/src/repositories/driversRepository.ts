import { schema } from '@rideshare/database';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type DriverProfileRow = typeof schema.driverProfiles.$inferSelect;
export type VehicleRow = typeof schema.vehicles.$inferSelect;
type DriverOnboardingStatusValue = DriverProfileRow['onboardingStatus'];

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

/** One row per driver, joined with their account's email/isActive —
 * the shape apps/admin-app's Drivers list and Driver Applications queue
 * (a status filter on the same list) both read. */
export interface DriverAdminRow {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  onboardingStatus: DriverOnboardingStatusValue;
  availabilityStatus: DriverProfileRow['availabilityStatus'];
  averageRating: string | null;
  ratingsCount: number;
  totalRides: number;
  licenseNumber: string;
  licenseState: string;
  licenseExpiresAt: Date | null;
  createdAt: Date;
}

const DRIVER_ADMIN_ROW_SELECTION = {
  id: schema.driverProfiles.id,
  userId: schema.driverProfiles.userId,
  firstName: schema.driverProfiles.firstName,
  lastName: schema.driverProfiles.lastName,
  email: schema.users.email,
  isActive: schema.users.isActive,
  onboardingStatus: schema.driverProfiles.onboardingStatus,
  availabilityStatus: schema.driverProfiles.availabilityStatus,
  averageRating: schema.driverProfiles.averageRating,
  ratingsCount: schema.driverProfiles.ratingsCount,
  totalRides: schema.driverProfiles.totalRides,
  licenseNumber: schema.driverProfiles.licenseNumber,
  licenseState: schema.driverProfiles.licenseState,
  licenseExpiresAt: schema.driverProfiles.licenseExpiresAt,
  createdAt: schema.driverProfiles.createdAt,
};

/** Section 14: "Drivers" / "Driver Applications" (the latter is just
 * this list filtered to PENDING_REVIEW — one admin-app page, a status
 * tab, not two separate backend concepts). */
export async function listDrivers(
  onboardingStatus?: DriverOnboardingStatusValue,
): Promise<DriverAdminRow[]> {
  return db
    .select(DRIVER_ADMIN_ROW_SELECTION)
    .from(schema.driverProfiles)
    .innerJoin(schema.users, eq(schema.driverProfiles.userId, schema.users.id))
    .where(onboardingStatus ? eq(schema.driverProfiles.onboardingStatus, onboardingStatus) : undefined)
    .orderBy(desc(schema.driverProfiles.createdAt));
}

/** "Inspect" a single driver — the base row for AdminDriverDetail;
 * vehicle and documents are composed on top by adminDriverService. */
export async function findDriverAdminRowById(driverId: string): Promise<DriverAdminRow | undefined> {
  const [row] = await db
    .select(DRIVER_ADMIN_ROW_SELECTION)
    .from(schema.driverProfiles)
    .innerJoin(schema.users, eq(schema.driverProfiles.userId, schema.users.id))
    .where(eq(schema.driverProfiles.id, driverId))
    .limit(1);
  return row;
}

/** Section 14's "Dashboard": drivers currently awaiting onboarding
 * review — the same filter listDrivers(?onboardingStatus=) exposes,
 * just a count. */
export async function countPendingDriverApplications(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.driverProfiles)
    .where(eq(schema.driverProfiles.onboardingStatus, 'PENDING_REVIEW'));
  return row?.total ?? 0;
}

/**
 * The four admin-triggered onboarding transitions (section 14: "approve
 * driver, reject driver, suspend driver, reactivate driver"), each a
 * plain atomic conditional `UPDATE ... WHERE id = ? AND onboarding_status
 * = fromStatus` — the same compare-and-swap pattern every state
 * transition in this codebase uses (ridesRepository.advanceRideStatus,
 * paymentsRepository.markPaymentOutcome, ...). Returns `undefined` if the
 * driver wasn't in the expected fromStatus, so the service layer can
 * turn that into a precise 409 rather than silently no-oping.
 *
 * Suspending also forces `availability_status` to OFFLINE in the same
 * update: `driver_profiles_availability_requires_approval_chk` only
 * allows ONLINE/BUSY while onboarding_status = APPROVED, so leaving
 * availability untouched here would make the UPDATE itself violate that
 * constraint the instant onboarding_status stops being APPROVED. A
 * driver suspended mid-ride keeps that one ride (this doesn't touch
 * `rides` at all) — see docs/admin-application.md's known limitations.
 */
export async function approveDriver(driverId: string): Promise<DriverProfileRow | undefined> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', updatedAt: new Date() })
    .where(
      and(eq(schema.driverProfiles.id, driverId), eq(schema.driverProfiles.onboardingStatus, 'PENDING_REVIEW')),
    )
    .returning();
  return updated;
}

export async function rejectDriver(driverId: string): Promise<DriverProfileRow | undefined> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'REJECTED', updatedAt: new Date() })
    .where(
      and(eq(schema.driverProfiles.id, driverId), eq(schema.driverProfiles.onboardingStatus, 'PENDING_REVIEW')),
    )
    .returning();
  return updated;
}

export async function suspendDriver(driverId: string): Promise<DriverProfileRow | undefined> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'SUSPENDED', availabilityStatus: 'OFFLINE', updatedAt: new Date() })
    .where(
      and(eq(schema.driverProfiles.id, driverId), eq(schema.driverProfiles.onboardingStatus, 'APPROVED')),
    )
    .returning();
  return updated;
}

export async function reactivateDriver(driverId: string): Promise<DriverProfileRow | undefined> {
  const [updated] = await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', updatedAt: new Date() })
    .where(
      and(eq(schema.driverProfiles.id, driverId), eq(schema.driverProfiles.onboardingStatus, 'SUSPENDED')),
    )
    .returning();
  return updated;
}

export interface VehicleAdminRow {
  id: string;
  driverId: string;
  driverFirstName: string;
  driverLastName: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  isActive: boolean;
}

/** Section 14's "Vehicles" — every vehicle across every driver, active
 * and retired (a retired vehicle stays visible for ride-history
 * context, same reasoning upsertVehicleForDriver's own comment gives
 * for never deleting one). */
export async function listAllVehicles(): Promise<VehicleAdminRow[]> {
  return db
    .select({
      id: schema.vehicles.id,
      driverId: schema.vehicles.driverId,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      color: schema.vehicles.color,
      licensePlate: schema.vehicles.licensePlate,
      isActive: schema.vehicles.isActive,
    })
    .from(schema.vehicles)
    .innerJoin(schema.driverProfiles, eq(schema.vehicles.driverId, schema.driverProfiles.id))
    .orderBy(desc(schema.vehicles.createdAt));
}
