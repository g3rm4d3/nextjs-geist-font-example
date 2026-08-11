import type { AssignedRideDriverInfo, RideStatus } from '@rideshare/types';
import { NotFoundError } from '../lib/errors';
import { routeProvider } from '../lib/mapProvider';
import { toVehicle } from '../lib/vehicleMapper';
import { findActiveVehicleForDriver } from '../repositories/driversRepository';
import { findDriverLocation } from '../repositories/locationsRepository';
import { findRideById } from '../repositories/ridesRepository';
import { findDriverProfileById, findPassengerProfileByUserId } from '../repositories/usersRepository';
import { toDriverLocation } from './locationService';

/** While the driver is heading to (or waiting at) pickup, "estimated
 * arrival" means arrival at pickup; once the passenger is actually in
 * the vehicle, it means arrival at the destination — same two-phase
 * split section 12's status list already draws. */
const PRE_ONBOARD_STATUSES: readonly RideStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
];
const ONBOARD_STATUSES: readonly RideStatus[] = ['PASSENGER_ONBOARD', 'IN_PROGRESS'];

/**
 * Section 10: "Passenger App: display assigned driver. Show: driver
 * first name, driver photo placeholder/test photo, vehicle, vehicle
 * color, license plate test data, driver location, estimated arrival."
 *
 * Returns `null` (not an error) whenever there's nothing to show —
 * before a driver is assigned (`ride.driverId` still null) and equally
 * once the ride is over (COMPLETED/cancelled): a driver was assigned at
 * some point in the ride's history, but there's nothing left to *track*.
 * The one thing this deliberately does not return is a photo: there is
 * no document/photo pipeline yet (that's Phase 15's `PROFILE_PHOTO`
 * document type) — `firstName` is enough for the client to render an
 * initials placeholder itself, which is what "driver photo placeholder"
 * means in Stage 1. See docs/realtime-ride-experience.md.
 */
export async function getAssignedDriverInfo(
  rideId: string,
  userId: string,
): Promise<AssignedRideDriverInfo | null> {
  const passengerProfile = await findPassengerProfileByUserId(userId);
  if (!passengerProfile) {
    throw new Error('Passenger profile not found for authenticated passenger user');
  }

  const ride = await findRideById(rideId);
  if (!ride || ride.passengerId !== passengerProfile.id) {
    throw new NotFoundError('Ride not found');
  }

  if (!ride.driverId || !(PRE_ONBOARD_STATUSES.includes(ride.status) || ONBOARD_STATUSES.includes(ride.status))) {
    return null;
  }

  const driverProfile = await findDriverProfileById(ride.driverId);
  if (!driverProfile) {
    // Unreachable in practice (driver_id is a foreign key that can't
    // dangle), but "nothing to show" is still the right answer, not a 500.
    return null;
  }

  const [vehicleRow, locationRow] = await Promise.all([
    findActiveVehicleForDriver(ride.driverId),
    findDriverLocation(ride.driverId),
  ]);

  let estimatedArrivalSeconds: number | null = null;
  if (locationRow) {
    const target = ONBOARD_STATUSES.includes(ride.status)
      ? { latitude: ride.destinationLat, longitude: ride.destinationLng }
      : { latitude: ride.pickupLat, longitude: ride.pickupLng };
    const route = await routeProvider.getRoute(
      { latitude: locationRow.latitude, longitude: locationRow.longitude },
      target,
    );
    estimatedArrivalSeconds = route.durationSeconds;
  }

  return {
    firstName: driverProfile.firstName,
    vehicle: vehicleRow ? toVehicle(vehicleRow) : null,
    location: locationRow ? toDriverLocation(locationRow) : null,
    estimatedArrivalSeconds,
  };
}
