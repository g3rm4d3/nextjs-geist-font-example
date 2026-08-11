import type { Vehicle } from '@rideshare/types';
import type { VehicleRow } from '../repositories/driversRepository';

/**
 * The one VehicleRow -> Vehicle mapping, shared by every service that
 * returns a `Vehicle` — driverService (Phase 5) and, as of Phase 10,
 * rideTrackingService and the admin active-rides listing. Extracted for
 * the same reason `lib/rideMapper.ts` was in Phase 9: a small dependency-
 * free leaf module beats a growing number of copies drifting apart.
 */
export function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    licensePlate: row.licensePlate,
    vin: row.vin,
    seats: row.seats,
  };
}
