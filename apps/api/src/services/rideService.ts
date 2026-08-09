import type { CreateRideRequest, Ride } from '@rideshare/types';
import { ConflictError, ForbiddenError } from '../lib/errors';
import { isUniqueViolation } from '../lib/pgErrors';
import { findPassengerProfileByUserId, findUserById } from '../repositories/usersRepository';
import {
  createRideAndAdvanceToSearching,
  findActiveRideForPassenger,
  findRideByIdempotencyKey,
  type RideRow,
} from '../repositories/ridesRepository';
import { getFareEstimateWithRoute } from './pricingService';

export interface RequestRideResult {
  ride: Ride;
  /** False when this call returned a pre-existing ride matching the
   * given idempotency key rather than creating a new one. */
  created: boolean;
}

function toRide(row: RideRow): Ride {
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
    requestedAt: row.requestedAt.toISOString(),
  };
}

/**
 * Section 7: "Passenger can submit ride request." Every validation the
 * spec lists happens here, server-side, independent of anything the
 * client claims:
 *
 *   - pickup / destination: bounds-checked by createRideRequestSchema
 *     before this function is ever called (400, not this function's job).
 *   - route / estimate: recomputed from scratch via
 *     pricingService.getFareEstimateWithRoute — the client's own on-
 *     screen estimate (Phase 4) is never trusted as input here; there is
 *     no fare field in CreateRideRequest for a client to even try
 *     (section 3).
 *   - passenger eligibility: the account must exist and be active.
 *   - active ride status: at most one non-terminal ride per passenger,
 *     enforced primarily by the database (rides_one_active_per_passenger_key)
 *     with a friendly check-first here to avoid hitting the constraint
 *     in the common (non-racing) case.
 *
 * Idempotency: a repeat call with the same idempotencyKey returns the
 * original ride (created: false) instead of erroring or duplicating —
 * see rides_passenger_idempotency_key_key and docs/ride-requests.md.
 */
export async function requestRide(
  userId: string,
  input: CreateRideRequest,
): Promise<RequestRideResult> {
  const user = await findUserById(userId);
  if (!user || !user.isActive) {
    throw new ForbiddenError('This account cannot request rides');
  }

  const passengerProfile = await findPassengerProfileByUserId(userId);
  if (!passengerProfile) {
    throw new Error('Passenger profile not found for authenticated passenger user');
  }

  const existing = await findRideByIdempotencyKey(passengerProfile.id, input.idempotencyKey);
  if (existing) {
    return { ride: toRide(existing), created: false };
  }

  const activeRide = await findActiveRideForPassenger(passengerProfile.id);
  if (activeRide) {
    throw new ConflictError('You already have an active ride');
  }

  const { route, fare } = await getFareEstimateWithRoute(
    input.pickup.coordinate,
    input.destination.coordinate,
  );

  try {
    const created = await createRideAndAdvanceToSearching(
      {
        passengerId: passengerProfile.id,
        idempotencyKey: input.idempotencyKey,
        pickupAddress: input.pickup.label,
        pickupLat: input.pickup.coordinate.latitude,
        pickupLng: input.pickup.coordinate.longitude,
        destinationAddress: input.destination.label,
        destinationLat: input.destination.coordinate.latitude,
        destinationLng: input.destination.coordinate.longitude,
        estimatedDistanceMeters: route.distanceMeters,
        estimatedDurationSeconds: route.durationSeconds,
        estimatedFareCents: fare.totalCents,
      },
      userId,
    );

    return { ride: toRide(created), created: true };
  } catch (error) {
    // Two requests can both pass the checks above and then race each
    // other into this insert — whichever the database accepted second
    // fails with one of these two constraint violations. Both are
    // resolved the same way idempotency-key replay is: fetch and return
    // the row that actually won, rather than surfacing a raw DB error.
    if (isUniqueViolation(error, 'rides_passenger_idempotency_key_key')) {
      const winner = await findRideByIdempotencyKey(passengerProfile.id, input.idempotencyKey);
      if (winner) return { ride: toRide(winner), created: false };
    }
    if (isUniqueViolation(error, 'rides_one_active_per_passenger_key')) {
      throw new ConflictError('You already have an active ride');
    }
    throw error;
  }
}
