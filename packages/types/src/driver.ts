/**
 * Driver-app API contracts, shared by apps/api (producer) and any client
 * (consumer). Reuses DriverOnboardingStatus/DriverAvailabilityStatus from
 * ./auth rather than redeclaring them, to avoid two conflicting
 * definitions of the same string union in this package.
 *
 * BUSY is deliberately not a value a driver (or this API) can set
 * directly — it's reserved for the matching/dispatch system (a later
 * phase) to mark a driver as mid-ride. Phase 5 only implements the
 * driver-initiated OFFLINE <-> ONLINE transition.
 */
import type { DriverAvailabilityStatus, DriverOnboardingStatus } from './auth';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  vin: string | null;
  seats: number;
}

export interface DriverProfileSummary {
  onboardingStatus: DriverOnboardingStatus;
  availabilityStatus: DriverAvailabilityStatus;
  vehicle: Vehicle | null;
  /** Phase 13's aggregate rating — null until this driver has received
   * their first PASSENGER_TO_DRIVER rating. */
  averageRating: number | null;
  ratingsCount: number;
}
