import type { Ride, RideOffer } from '@rideshare/types';
import { schema } from '@rideshare/database';
import {
  DEFAULT_SEARCH_RADII_METERS,
  rankCandidates,
  selectCandidatesWithinExpandingRadius,
  type MatchingCandidate,
} from '@rideshare/matching';
import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import { ConflictError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { routeProvider } from '../lib/mapProvider';
import { toRide } from '../lib/rideMapper';
import {
  createOffer,
  declineOfferAtomic,
  findEligibleDrivers,
  findExpiredOpenOffers,
  findOpenOfferForDriver,
  findTriedDriverIdsForRide,
  expireOfferAtomic,
} from '../repositories/matchingRepository';
import { findRideById } from '../repositories/ridesRepository';
import { findDriverProfileByUserId } from '../repositories/usersRepository';
import { STALE_THRESHOLD_MS } from './locationService';

/**
 * Every exported function below that a driver calls on themselves takes
 * their authenticated userId, not a driver_profiles id directly — same
 * convention as driverService (see its requireDriverProfile), so route
 * handlers stay thin and never resolve the profile themselves. requireRole
 * ('DRIVER') already guarantees the role; the profile row is still looked
 * up independently rather than trusted from the token.
 */
async function requireDriverId(userId: string): Promise<string> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');
  return profile.id;
}

/** GET /drivers/me/offer: the driver's currently-open offer (if any),
 * with the ride details they need to decide. Returns null rather than
 * throwing when there is none — "no offer right now" is the normal,
 * common case for a driver polling this endpoint, not an error. */
export async function getCurrentOffer(userId: string): Promise<RideOffer | null> {
  const driverId = await requireDriverId(userId);
  const offer = await findOpenOfferForDriver(driverId);
  if (!offer) return null;

  const ride = await findRideById(offer.rideId);
  if (!ride) {
    // Should be unreachable (rideId is a foreign key), but a stray offer
    // pointing nowhere is a "no offer" from this driver's perspective,
    // not a 500.
    return null;
  }

  return { id: offer.id, ride: toRide(ride), expiresAt: offer.expiresAt.toISOString() };
}

export type MatchAttemptOutcome =
  | { outcome: 'offered'; rideRequestId: string; driverId: string }
  | { outcome: 'no_candidates' }
  | { outcome: 'ride_not_searching' };

/**
 * Section 8's offer flow, one attempt at a time: "Ride Request → candidate
 * search → offer driver → response timer → ACCEPT/DECLINE/TIMEOUT → next
 * candidate if necessary." This function *is* "candidate search → offer
 * driver" — it is deliberately the only place that creates a ride_requests
 * row, and it is deliberately idempotent-safe to call repeatedly for the
 * same ride (rideService.requestRide calls it once to start matching;
 * handleDecline and sweepExpiredOffers call it again, under the same
 * name conceptually meaning "advance to the next candidate," every time
 * the previously-offered candidate stops being a live option). Because it
 * always excludes every driver already tried for this ride
 * (findTriedDriverIdsForRide), "start" and "advance" are the same
 * operation — there is no separate state to track between them.
 */
async function findAndOfferNextCandidate(rideId: string): Promise<MatchAttemptOutcome> {
  const ride = await findRideById(rideId);
  if (!ride) {
    throw new NotFoundError('Ride not found');
  }

  // A ride that isn't (still) SEARCHING_DRIVER has already been resolved
  // by something else — accepted, cancelled, or otherwise moved on. Not
  // an error: a decline or sweep that loses a race with an accept should
  // just quietly stop, not throw.
  if (ride.status !== 'SEARCHING_DRIVER') {
    return { outcome: 'ride_not_searching' };
  }

  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const triedDriverIds = await findTriedDriverIdsForRide(rideId);
  const eligible = await findEligibleDrivers(staleCutoff, triedDriverIds);

  if (eligible.length === 0) {
    logger.info({ rideId }, 'Matching: no eligible drivers found');
    return { outcome: 'no_candidates' };
  }

  // Distance/ETA per candidate, via the same RouteProvider abstraction
  // pricingService uses (currently the MOCK haversine provider — see
  // apps/api/src/lib/mapProvider.ts and docs/maps.md). Computed fresh
  // here rather than trusting anything cached, same server-authoritative
  // principle as fare estimation (section 3).
  const candidates: MatchingCandidate[] = await Promise.all(
    eligible.map(async (driver) => {
      const route = await routeProvider.getRoute(
        { latitude: driver.latitude, longitude: driver.longitude },
        { latitude: ride.pickupLat, longitude: ride.pickupLng },
      );
      return {
        driverId: driver.driverId,
        distanceMeters: route.distanceMeters,
        etaSeconds: route.durationSeconds,
        availableSinceMs: driver.availableSince.getTime(),
      };
    }),
  );

  const tier = selectCandidatesWithinExpandingRadius(candidates, DEFAULT_SEARCH_RADII_METERS);
  if (!tier) {
    logger.info({ rideId }, 'Matching: no eligible drivers within any search radius');
    return { outcome: 'no_candidates' };
  }

  const [top] = rankCandidates(tier.candidates, Date.now());
  if (!top) {
    return { outcome: 'no_candidates' };
  }

  const expiresAt = new Date(Date.now() + env.MATCHING_OFFER_TIMEOUT_SECONDS * 1000);
  const offer = await createOffer(rideId, top.driverId, expiresAt);

  logger.info(
    { rideId, driverId: top.driverId, rideRequestId: offer.id, radiusMeters: tier.radiusMeters },
    'Matching: offered ride to driver',
  );

  return { outcome: 'offered', rideRequestId: offer.id, driverId: top.driverId };
}

/**
 * Entry point called once by rideService.requestRide immediately after a
 * ride reaches SEARCHING_DRIVER (Phase 7 deliberately deferred this call
 * to this phase). Finding zero candidates is a valid, non-error outcome —
 * the ride simply stays SEARCHING_DRIVER; see docs/matching-engine.md's
 * "known limitations" for what does (and does not) automatically retry
 * that case in Stage 1.
 */
export async function startMatching(rideId: string): Promise<MatchAttemptOutcome> {
  return findAndOfferNextCandidate(rideId);
}

/** Re-runs candidate search excluding every driver already tried for this
 * ride, offering the next best candidate if one exists. Called after a
 * decline (handleDecline) or a sweep-driven timeout (sweepExpiredOffers). */
export async function advanceToNextCandidate(rideId: string): Promise<MatchAttemptOutcome> {
  return findAndOfferNextCandidate(rideId);
}

/**
 * Section 8: "Acceptance MUST be atomic. Two drivers attempting to accept
 * simultaneously must result in exactly ONE winner."
 *
 * The `rides` row is the single resource that actually decides the
 * winner, and this transaction deliberately locks it *first*, before
 * writing anything to `ride_requests`:
 *
 *   1. UPDATE rides ... WHERE status = 'SEARCHING_DRIVER'. Postgres's
 *      row-level locking on this one row is what serializes concurrent
 *      accept transactions for the same ride — only the first to commit
 *      sees SEARCHING_DRIVER; everyone else finds DRIVER_ASSIGNED
 *      already and affects zero rows.
 *   2. Only *after* winning that lock does the winner touch
 *      ride_requests: mark its own offer ACCEPTED (still conditional on
 *      OFFERED, for the narrow case of a sweep expiring this exact row
 *      in the same instant — see the throw below) and expire every
 *      other still-OFFERED row for the ride.
 *
 * This ordering is not incidental. An earlier version wrote to the
 * driver's own ride_requests row *before* racing for the rides row —
 * that let one transaction hold a lock on its own (losing) row while
 * blocked waiting on `rides`, and let the winner's later "expire every
 * other OFFERED row" step try to lock that same row, producing a real
 * Postgres deadlock under exactly the concurrent-accept load this
 * function exists to handle (caught by this phase's own 50-driver
 * concurrency test). Locking `rides` first means a losing transaction
 * never holds any ride_requests lock while it waits, so no cycle can
 * form. See docs/matching-engine.md.
 */
export async function handleAccept(rideRequestId: string, userId: string): Promise<Ride> {
  const driverId = await requireDriverId(userId);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    // Unlocked read — deliberately not `FOR UPDATE` and not a write, so
    // it never becomes the lock a concurrent transaction could deadlock
    // against. Just enough to find which ride this offer belongs to and
    // fail fast if it's already unmistakably not usable; the conditional
    // UPDATE below is what actually re-checks OFFERED authoritatively.
    const [existingRequest] = await tx
      .select()
      .from(schema.rideRequests)
      .where(
        and(eq(schema.rideRequests.id, rideRequestId), eq(schema.rideRequests.driverId, driverId)),
      )
      .limit(1);

    if (!existingRequest || existingRequest.status !== 'OFFERED') {
      return { outcome: 'offer_unavailable' as const };
    }

    const [assignedRide] = await tx
      .update(schema.rides)
      .set({ status: 'DRIVER_ASSIGNED', driverId, matchedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.rides.id, existingRequest.rideId),
          eq(schema.rides.status, 'SEARCHING_DRIVER'),
        ),
      )
      .returning();

    if (!assignedRide) {
      // Lost the race for the ride itself — another driver's accept
      // committed first. Not rolled back to OFFERED, not left ACCEPTED:
      // explicitly EXPIRED, a single-row conditional update that can
      // never conflict with anything the (already-committed) winner did.
      await tx
        .update(schema.rideRequests)
        .set({ status: 'EXPIRED', respondedAt: now })
        .where(
          and(eq(schema.rideRequests.id, rideRequestId), eq(schema.rideRequests.status, 'OFFERED')),
        );
      return { outcome: 'ride_already_assigned' as const };
    }

    // We now hold the ride's lock and have just won it: no other
    // transaction can be concurrently mid-way through this same sequence
    // for this ride. Mark this specific offer ACCEPTED...
    const [acceptedRequest] = await tx
      .update(schema.rideRequests)
      .set({ status: 'ACCEPTED', respondedAt: now })
      .where(
        and(
          eq(schema.rideRequests.id, rideRequestId),
          eq(schema.rideRequests.driverId, driverId),
          eq(schema.rideRequests.status, 'OFFERED'),
        ),
      )
      .returning();

    if (!acceptedRequest) {
      // Vanishingly narrow window: a sweep expired this exact offer
      // between the unlocked read above and here. Throwing rolls back
      // the ride assignment too, inside this same transaction — this
      // accept attempt never happened, rather than committing a ride to
      // a driver whose own offer was not actually still valid.
      throw new ConflictError('This ride offer is no longer available to respond to');
    }

    // ...flip the driver to BUSY, and expire every other still-OFFERED
    // row for this ride (defense-in-depth; the sequential offer flow
    // shouldn't normally leave any, but nothing here assumes that).
    await tx
      .update(schema.driverProfiles)
      .set({ availabilityStatus: 'BUSY', updatedAt: now })
      .where(eq(schema.driverProfiles.id, driverId));

    await tx
      .update(schema.rideRequests)
      .set({ status: 'EXPIRED', respondedAt: now })
      .where(
        and(
          eq(schema.rideRequests.rideId, acceptedRequest.rideId),
          eq(schema.rideRequests.status, 'OFFERED'),
        ),
      );

    await tx.insert(schema.rideEvents).values({
      rideId: acceptedRequest.rideId,
      previousStatus: 'SEARCHING_DRIVER',
      newStatus: 'DRIVER_ASSIGNED',
      actorType: 'DRIVER',
      actorUserId: null,
      metadata: { driverId, rideRequestId },
    });

    return { outcome: 'accepted' as const, ride: assignedRide };
  });

  if (result.outcome === 'offer_unavailable') {
    throw new ConflictError('This ride offer is no longer available to respond to');
  }
  if (result.outcome === 'ride_already_assigned') {
    throw new ConflictError('This ride was already accepted by another driver');
  }

  logger.info(
    { rideId: result.ride.id, driverId, rideRequestId },
    'Matching: driver accepted ride offer',
  );

  return toRide(result.ride);
}

/** Atomically declines exactly one offer (see
 * matchingRepository.declineOfferAtomic), then advances matching to the
 * next candidate for that ride. */
export async function handleDecline(rideRequestId: string, userId: string): Promise<void> {
  const driverId = await requireDriverId(userId);
  const now = new Date();
  const declined = await declineOfferAtomic(rideRequestId, driverId, now);
  if (!declined) {
    throw new ConflictError('This ride offer is no longer available to respond to');
  }

  logger.info(
    { rideId: declined.rideId, driverId, rideRequestId },
    'Matching: driver declined ride offer',
  );
  await advanceToNextCandidate(declined.rideId);
}

/**
 * Called on a timer (src/index.ts — never from createApp(), so test runs
 * stay deterministic; see docs/matching-engine.md). For every OFFERED row
 * whose response timer has elapsed, atomically expires it and — only for
 * the ones this call actually wins the race to expire (see
 * expireOfferAtomic's own doc comment) — advances that ride to the next
 * candidate.
 */
export async function sweepExpiredOffers(): Promise<number> {
  const now = new Date();
  const candidates = await findExpiredOpenOffers(now);

  let expiredCount = 0;
  for (const candidate of candidates) {
    const expired = await expireOfferAtomic(candidate.id, now);
    if (!expired) continue; // Lost the race to a concurrent decline/accept — not this sweep's to advance.
    expiredCount += 1;
    logger.info(
      { rideId: expired.rideId, driverId: expired.driverId, rideRequestId: expired.id },
      'Matching: offer expired (timeout)',
    );
    await advanceToNextCandidate(expired.rideId);
  }

  return expiredCount;
}
