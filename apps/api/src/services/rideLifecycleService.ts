import { haversineDistanceMeters } from '@rideshare/maps';
import type { Ride, RideStatus } from '@rideshare/types';
import { ConflictError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { toRide } from '../lib/rideMapper';
import { findRideLocationSamples } from '../repositories/rideLocationSamplesRepository';
import {
  advanceRideStatus,
  findRideById,
  type RideLifecycleExtraFields,
  type RideRow,
} from '../repositories/ridesRepository';
import {
  findDriverProfileByUserId,
  findPassengerProfileById,
  findPassengerProfileByUserId,
} from '../repositories/usersRepository';
import { recordEarningsForCompletedRide } from './earningsService';
import {
  notifyDriverApproaching,
  notifyDriverArrived,
  notifyRideCompleted,
  notifyRideStarted,
} from './notificationService';
import { chargeRideFare } from './paymentService';
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
/** Phase 16 events fired off a ride status transition — three of
 * driverTransition's four callers get one (markPassengerOnboard passes
 * none, see markPassengerOnboard's own comment); completeRide has its
 * own bespoke body and calls this directly rather than through
 * driverTransition, but shares the same notification map and best-
 * effort shape. */
type DriverTransitionNotification = 'approaching' | 'arrived' | 'started' | 'completed';

const NOTIFY_BY_TRANSITION: Record<DriverTransitionNotification, (userId: string, rideId: string) => Promise<unknown>> = {
  approaching: notifyDriverApproaching,
  arrived: notifyDriverArrived,
  started: notifyRideStarted,
  completed: notifyRideCompleted,
};

/**
 * Best-effort, same "must not fail the primary action" precedent as
 * rideService.requestRide's startMatching call. `passengerId` is the raw
 * pre-mapped row's field (never re-derived from `toRide`'s API-facing
 * shape) — this always runs against the just-updated database row.
 */
async function notifyForDriverTransition(
  passengerId: string,
  rideId: string,
  notification: DriverTransitionNotification,
): Promise<void> {
  try {
    const passenger = await findPassengerProfileById(passengerId);
    if (!passenger) return;
    await NOTIFY_BY_TRANSITION[notification](passenger.userId, rideId);
  } catch (notificationError) {
    logger.error(
      { err: notificationError, rideId, notification },
      'Failed to send ride lifecycle notification',
    );
  }
}

async function driverTransition(
  rideId: string,
  userId: string,
  fromStatus: RideStatus,
  toStatus: RideStatus,
  extraFields?: RideLifecycleExtraFields,
  notification?: DriverTransitionNotification,
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

  if (notification) {
    await notifyForDriverTransition(updated.passengerId, rideId, notification);
  }

  return toRide(updated);
}

/** Sums consecutive-sample haversine distances from `ride_location_samples`
 * into a measured trip distance. Falls back to the pre-trip route
 * estimate when there are fewer than two samples — one point alone has
 * no distance to measure, and zero points means recordRouteSampleIfDue
 * never got a chance to run (a very short ride, or GPS pings that never
 * arrived during it). */
async function computeActualDistanceMeters(
  rideId: string,
  estimatedDistanceMeters: number | null,
): Promise<number> {
  const samples = await findRideLocationSamples(rideId);
  if (samples.length < 2) {
    return estimatedDistanceMeters ?? 0;
  }

  let totalMeters = 0;
  for (let i = 1; i < samples.length; i += 1) {
    totalMeters += haversineDistanceMeters(samples[i - 1]!, samples[i]!);
  }
  return Math.round(totalMeters);
}

export async function markEnRoute(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(
    rideId,
    userId,
    FORWARD_FROM_STATUS.markEnRoute,
    'DRIVER_EN_ROUTE',
    undefined,
    'approaching',
  );
}

export async function markArrived(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(
    rideId,
    userId,
    FORWARD_FROM_STATUS.markArrived,
    'DRIVER_ARRIVED',
    undefined,
    'arrived',
  );
}

/** No Phase 16 event: the spec's canonical event list has no
 * "passenger onboard" notification, and the passenger who just got in
 * the car doesn't need to be told they did. */
export async function markPassengerOnboard(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(
    rideId,
    userId,
    FORWARD_FROM_STATUS.markPassengerOnboard,
    'PASSENGER_ONBOARD',
  );
}

export async function startTrip(rideId: string, userId: string): Promise<Ride> {
  return driverTransition(
    rideId,
    userId,
    FORWARD_FROM_STATUS.startTrip,
    'IN_PROGRESS',
    { startedAt: new Date() },
    'started',
  );
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
 * estimate (section 3) but from the trip's *actual* duration/distance.
 * `actualDurationSeconds` is genuinely real elapsed wall-clock time
 * (started_at to now). `actualDistanceMeters` is now genuinely measured
 * too, as of Phase 10: the sum of consecutive-sample haversine distances
 * from `ride_location_samples` (see locationService.recordRouteSampleIfDue
 * for how those get recorded, throttled by RIDE_LOCATION_SAMPLE_INTERVAL_MS).
 * That sum still undercounts true road distance the same way any
 * straight-line-segment approximation does — finer sampling would track
 * closer, at the storage-growth cost "do not persist unnecessary high-
 * frequency data" exists to bound — but it is a real measurement now,
 * not a guess. Falls back to the pre-trip route estimate only when fewer
 * than two samples exist (e.g. a ride completed faster than one sampling
 * interval, common in manual/test runs) — see docs/realtime-ride-experience.md.
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
  const actualDistanceMeters = await computeActualDistanceMeters(rideId, ride.estimatedDistanceMeters);
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

  // Phase 11: charge the passenger for the ride now that its final fare
  // is authoritative. Best-effort, same as startMatching in rideService
  // — a payment-provider hiccup must not fail ride completion itself;
  // the ride is COMPLETED either way, and a failed charge is a real,
  // visible payment_records row the passenger can retry (see
  // paymentService.retryRidePayment), not a swallowed error.
  try {
    await chargeRideFare(rideId);
  } catch (paymentError) {
    logger.error({ err: paymentError, rideId }, 'Failed to charge payment for completed ride');
  }

  // Phase 12: record the driver's earnings ledger entry for this ride,
  // from the exact same `fare` breakdown already computed above (never
  // a second, possibly-drifting calculation). Best-effort for the same
  // reason as chargeRideFare just above — the ride is COMPLETED
  // regardless, and a missed ledger row would be a bug to fix, not a
  // reason to fail the ride.
  try {
    await recordEarningsForCompletedRide(rideId, driverId, fare);
  } catch (earningsError) {
    logger.error({ err: earningsError, rideId }, 'Failed to record earnings for completed ride');
  }

  // Phase 16's "ride completed" event. completeRide doesn't go through
  // driverTransition (it has its own bespoke body above), so it fires
  // its own notification directly rather than through
  // notifyForDriverTransition — same best-effort shape regardless.
  await notifyForDriverTransition(updated.passengerId, rideId, 'completed');

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
