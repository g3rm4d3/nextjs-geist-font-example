import type { Ride } from '@rideshare/types';
import type { RideRow } from '../repositories/ridesRepository';

/**
 * The one RideRow -> Ride mapping, shared by every service that returns
 * a `Ride` (rideService, matchingService, rideLifecycleService). Lives
 * here — a small leaf module with no service-level imports of its own —
 * specifically so those services can all import it without any of them
 * importing *each other*: rideService calls matchingService.startMatching,
 * and matchingService/rideLifecycleService both return `Ride`s, so any
 * one of them owning this function would make at least one of the
 * others depend back on it, a circular module dependency (see Phase 8's
 * matchingService, which duplicated this function instead, before this
 * shared module existed).
 */
export function toRide(row: RideRow): Ride {
  return {
    id: row.id,
    status: row.status,
    pickup: {
      coordinate: { latitude: row.pickupLat, longitude: row.pickupLng },
      label: row.pickupAddress,
    },
    destination: {
      coordinate: { latitude: row.destinationLat, longitude: row.destinationLng },
      label: row.destinationAddress,
    },
    estimatedDistanceMeters: row.estimatedDistanceMeters,
    estimatedDurationSeconds: row.estimatedDurationSeconds,
    estimatedFareCents: row.estimatedFareCents,
    actualDistanceMeters: row.actualDistanceMeters,
    actualDurationSeconds: row.actualDurationSeconds,
    finalFareCents: row.finalFareCents,
    cancellationReason: row.cancellationReason,
    cancellationFeeCents: row.cancellationFeeCents,
    requestedAt: row.requestedAt.toISOString(),
  };
}
