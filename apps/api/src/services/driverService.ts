import type { DriverProfileSummary, Vehicle } from '@rideshare/types';
import type { UpdateAvailabilityInput, UpsertVehicleInput } from '@rideshare/validation';
import { ConflictError, ForbiddenError, ValidationError } from '../lib/errors';
import { isUniqueViolation } from '../lib/pgErrors';
import { toVehicle } from '../lib/vehicleMapper';
import { findDriverProfileByUserId } from '../repositories/usersRepository';
import {
  findActiveVehicleForDriver,
  submitDriverApplication,
  updateDriverAvailability,
  upsertVehicleForDriver,
  type DriverProfileRow,
  type VehicleRow,
} from '../repositories/driversRepository';

function toSummary(profile: DriverProfileRow, vehicle: VehicleRow | undefined): DriverProfileSummary {
  return {
    onboardingStatus: profile.onboardingStatus,
    availabilityStatus: profile.availabilityStatus,
    vehicle: vehicle ? toVehicle(vehicle) : null,
  };
}

/**
 * requireRole('DRIVER') already guarantees req.auth.role === 'DRIVER',
 * but the driver_profiles row is looked up independently rather than
 * trusted from the token — the profile (and its current onboarding /
 * availability status) is the actual source of truth, not the JWT.
 */
async function requireDriverProfile(userId: string): Promise<DriverProfileRow> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');
  return profile;
}

export async function getDriverProfileSummary(userId: string): Promise<DriverProfileSummary> {
  const profile = await requireDriverProfile(userId);
  const vehicle = await findActiveVehicleForDriver(profile.id);
  return toSummary(profile, vehicle);
}

export async function upsertVehicle(userId: string, input: UpsertVehicleInput): Promise<Vehicle> {
  const profile = await requireDriverProfile(userId);

  try {
    const vehicle = await upsertVehicleForDriver(profile.id, input);
    return toVehicle(vehicle);
  } catch (error) {
    if (isUniqueViolation(error, 'vehicles_license_plate_key')) {
      throw new ConflictError('A vehicle with this license plate already exists');
    }
    if (isUniqueViolation(error, 'vehicles_vin_key')) {
      throw new ConflictError('A vehicle with this VIN already exists');
    }
    throw error;
  }
}

export async function submitApplication(userId: string): Promise<DriverProfileSummary> {
  const profile = await requireDriverProfile(userId);
  const vehicle = await findActiveVehicleForDriver(profile.id);

  if (!vehicle) {
    throw new ValidationError('Add your vehicle before submitting your application for review');
  }
  if (profile.onboardingStatus !== 'DRAFT') {
    throw new ConflictError(
      `Application cannot be submitted from status ${profile.onboardingStatus}`,
    );
  }

  const updated = await submitDriverApplication(profile.id);
  return toSummary(updated, vehicle);
}

export async function setAvailability(
  userId: string,
  input: UpdateAvailabilityInput,
): Promise<DriverProfileSummary> {
  const profile = await requireDriverProfile(userId);

  // The DB's CHECK constraint (driver_profiles_availability_requires_approval_chk)
  // would reject this too, but failing fast here with a clear message is
  // better than surfacing a raw constraint-violation error to the client.
  if (input.status === 'ONLINE' && profile.onboardingStatus !== 'APPROVED') {
    throw new ForbiddenError('Only approved drivers can go online');
  }

  const updated = await updateDriverAvailability(profile.id, input.status);
  const vehicle = await findActiveVehicleForDriver(profile.id);
  return toSummary(updated, vehicle);
}
