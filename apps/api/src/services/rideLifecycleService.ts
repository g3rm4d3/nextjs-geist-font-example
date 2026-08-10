import type { Ride, RideStatus } from '@rideshare/types';
import { ConflictError, NotFoundError } from '../lib/errors';
import { toRide } from '../lib/rideMapper';
import {
  advanceRideStatus,
  findRideById,
  type RideLifecycleExtraFields,
  type RideRow,
} from '../repositories/ridesRepository';
import {
  findDriverProfileByUserId,
  findPassengerProfileByUserId,
} from '../repositories/usersRepository';
import { getFareForActualTrip } from './pricingService';

async function requireDriverId(userId: string): Promise<string> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');
  return profile.id;
}

async function requirePassengerId(userId: string): Promise<string> {
  const profile = await findPassengerProfileByUserId(userId);
  if (!profile) throw new Error('Passenger profile not found for authenticated passenger user');
  return profile.id;
}

/**
 * Section 9's strict forward lifecycle, one step per driver action:
 *
 *   DRIVER_ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED
 *     -> PASSENGER_ONBOARD -> IN_PROGRESS -> COMPLETED
 *
 * Every arrow above is its own named function below, each a single fixed
 * `fromStatus -> toStatus` pair — never a range of acceptable starting
 * states — so "driver cannot complete a ride that never started" and
 * "every transition generates its own ride_event" both fall out of the
 * data model rather than needing separate enforcement code.
 */
const FORWARD_FROM_STATUS: Record<
  'markEnRoute' | 'markArrived' | 'markPassengerOnboard' | 'startTrip',
  RideStatus
> = {
  markEnRoute: 'DRIVER_ASSIGNED',
  markArrived: 'DRIVER_EN_ROUTE',
  markPassengerOnboard: 'DRIVER_ARRIVED',
  startTrip: 'PASSENGER_ONBOARD',
};

/**
 * Shared by every driver-facing forward transition. Reads the ride first
 * — same "unlocked read for a friendly, specific error; conditional
 * write for the actual atomic guarantee" split Phase 8's handleAccept
 * uses — so a driver gets a precise reason (not found / wrong state)
 * without that read being what actually enforces anything.
 *
 * A ride that doesn't exist *or* belongs to a different driver both
 * surface as `NotFoundError` (404), never `ForbiddenError` (403): a
 * driver hitting an endpoint for a ride that isn't theirs shouldn't be
 * able to tell the difference between "no such ride" and "someone
 * else's ride" — the second case would confirm that ride exists at all,
 * a small but real information leak. This is what "driver cannot operate
 * another driver's ride" means concretely, at every one of these
 * endpoints, not just the atomic accept from Phase 8.
 */
async function driverTransition(
  rideId: string,
  userId: string,
  fromStatus: RideStatus,
  toStatus: RideStatus,
  extraFields?: RideLifecycleExtraFields,
): Promise<Ride> {
  const driverId = await requireDriverId(userId);
  const ride = await findRideById(rideId);
  if (!ride || ride.driverId !== driverId) {
    throw new NotFoundError('Ride not found');
  }
  if (ride.status !== fromStatus) {
    throw new ConflictError(`Cannot advance to ${toStatus} from ${ride.status}`);
  }

  const updated = await advanceRideStatus({
    rideId,
    fromStatus,
    toStatus,
    driverId,
    extraFields,
    actorType: 'DRIVER',
    actorUserId: userId,
  });

  if (!updated) {
    // Lost a race between the read above and the atomic write (e.g. the
    // passenger cancelled in the same instant) — the pre-read's message
    // no longer applies; this is the authoritative outcome.
    throw new ConflictError('This ride is no longer in a state that allows this action');
  }

  return toRide(updated);
}

export async function markEnRoute(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(rideId, userId, FORWARD_FROM_STATUS.markEnRoute, 'DRIVER_EN_ROUTE');
}

export async function markArrived(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(rideId, userId, FORWARD_FROM_STATUS.markArrived, 'DRIVER_ARRIVED');
}

export async function markPassengerOnboard(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(
    rideId,
    userId,
    FORWARD_FROM_STATUS.markPassengerOnboard,
    'PASSENGER_ONBOARD',
  );
}

export async function startTrip(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(rideId, userId, FORWARD_FROM_STATUS.startTrip, 'IN_PROGRESS', {
    startedAt: new Date(),
  });
}

/**
 * "Driver cannot complete ride that never started": COMPLETED is only
 * ever reached from IN_PROGRESS, which is only ever reached via
 * startTrip above (the only place `started_at` is ever set) — so the
 * `fromStatus !== 'IN_PROGRESS'` check below and the `startedAt` guard
 * enforce the same rule twice, belt-and-suspenders, not two different
 * rules.
 *
 * The final fare is computed the same server-authoritative way as the
 * estimate (section 3) but from the trip's *actual* duration/distance —
 * see pricingService.getFareForActualTrip for what "actual" means with
 * no live route tracking in Stage 1 (duration is genuinely real elapsed
 * time; distance reuses the pre-trip estimate — documented limitation).
 */
export async function completeRide(rideId: string, userId: string): Promise<Ride> {
  const driverId = await requireDriverId(userId);
  const ride = await findRideById(rideId);
  if (!ride || ride.driverId !== driverId) {
    throw new NotFoundError('Ride not found');
  }
  if (ride.status !== 'IN_PROGRESS' || !ride.startedAt) {
    throw new ConflictError('This ride has not started and cannot be completed');
  }

  const now = new Date();
  const actualDurationSeconds = Math.max(
    1,
    Math.round((now.getTime() - ride.startedAt.getTime()) / 1000),
  );
  const actualDistanceMeters = ride.estimatedDistanceMeters ?? 0;
  const fare = await getFareForActualTrip(actualDistanceMeters, actualDurationSeconds);

  const updated = await advanceRideStatus({
    rideId,
    fromStatus: 'IN_PROGRESS',
    toStatus: 'COMPLETED',
    driverId,
    extraFields: {
      completedAt: now,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareCents: fare.totalCents,
    },
    actorType: 'DRIVER',
    actorUserId: userId,
    releaseDriverId: driverId,
  });

  if (!updated) {
    throw new ConflictError('This ride is no longer in a state that allows this action');
  }

  return toRide(updated);
}

/** Cancellable up through DRIVER_ARRIVED — once a passenger is actually
 * onboard (PASSENGER_ONBOARD / IN_PROGRESS), the trip is underway and a
 * plain cancel no longer applies to either side; that's a different,
 * unimplemented (Stage 1 out-of-scope) "incident" concern, not this
 * function's. */
const CANCELLABLE_STATUSES: readonly RideStatus[] = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
];

type CancelActor = 'PASSENGER' | 'DRIVER' | 'SYSTEM';

async function cancelRide(
  rideId: string,
  actor: CancelActor,
  ownerCheck: ((ride: RideRow) => boolean) | null,
  actorUserId: string | null,
  reason: string | undefined,
): Promise<Ride> {
  const ride = await findRideById(rideId);
  if (!ride || (ownerCheck && !ownerCheck(ride))) {
    throw new NotFoundError('Ride not found');
  }
  if (!CANCELLABLE_STATUSES.includes(ride.status)) {
    throw new ConflictError(`A ride in ${ride.status} can no longer be cancelled`);
  }

  const toStatus: RideStatus =
    actor === 'PASSENGER'
      ? 'CANCELLED_BY_PASSENGER'
      : actor === 'DRIVER'
        ? 'CANCELLED_BY_DRIVER'
        : 'CANCELLED_BY_SYSTEM';

  const updated = await advanceRideStatus({
    rideId,
    fromStatus: ride.status,
    toStatus,
    driverId: actor === 'DRIVER' ? (ride.driverId ?? undefined) : undefined,
    extraFields: {
      cancelledAt: new Date(),
      cancelledBy: actor,
      cancellationReason: reason ?? null,
    },
    actorType: actor,
    actorUserId,
    // A driver was assigned iff ride.driverId is set — cancelling before
    // a match (REQUESTED/SEARCHING_DRIVER) has no driver to release.
    releaseDriverId: ride.driverId ?? undefined,
  });

  if (!updated) {
    throw new ConflictError('This ride is no longer in a state that allows this action');
  }

  return toRide(updated);
}

/** "Passenger cannot arbitrarily modify state": this is the *only*
 * passenger-facing state-changing action in this entire service, and
 * it's restricted to a fixed set of pre-onboard statuses (see
 * CANCELLABLE_STATUSES) — there is no endpoint anywhere that lets a
 * passenger set a ride's status directly. */
export async function cancelRideByPassenger(
  rideId: string,
  userId: string,
  reason?: string,
): Promise<Ride> {
  const passengerId = await requirePassengerId(userId);
  return cancelRide(
    rideId,
    'PASSENGER',
    (ride) => ride.passengerId === passengerId,
    userId,
    reason,
  );
}

export async function cancelRideByDriver(
  rideId: string,
  userId: string,
  reason?: string,
): Promise<Ride> {
  const driverId = await requireDriverId(userId);
  return cancelRide(rideId, 'DRIVER', (ride) => ride.driverId === driverId, userId, reason);
}

/**
 * Reachable and fully tested, but nothing in Stage 1 calls this yet —
 * there is no automatic trigger (e.g. "no driver found for too long")
 * wired up; see docs/ride-lifecycle.md's known limitations. Kept as a
 * real function rather than deleted so `CANCELLED_BY_SYSTEM` is an
 * actually-producible code path, not a schema value nothing can reach.
 */
export async function cancelRideBySystem(rideId: string, reason: string): Promise<Ride> {
  return cancelRide(rideId, 'SYSTEM', null, null, reason);
}

/** Read access, gated to the ride's own passenger or driver — used for
 * polling a ride's current status from either app. Same not-found-not-
 * forbidden treatment as driverTransition above for a mismatched caller. */
export async function getRideForUser(
  rideId: string,
  userId: string,
  role: 'PASSENGER' | 'DRIVER',
): Promise<Ride> {
  const ride = await findRideById(rideId);
  if (!ride) throw new NotFoundError('Ride not found');

  if (role === 'PASSENGER') {
    const passengerId = await requirePassengerId(userId);
    if (ride.passengerId !== passengerId) throw new NotFoundError('Ride not found');
  } else {
    const driverId = await requireDriverId(userId);
    if (ride.driverId !== driverId) throw new NotFoundError('Ride not found');
  }

  return toRide(ride);
}
