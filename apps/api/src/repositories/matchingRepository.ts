import { schema } from '@rideshare/database';
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { isUniqueViolation } from '../lib/pgErrors';

export type RideRequestRow = typeof schema.rideRequests.$inferSelect;

export interface EligibleDriverRow {
  driverId: string;
  latitude: number;
  longitude: number;
  locationRecordedAt: Date;
  /** Proxy for "how long has this driver been available" —
   * driver_profiles.updated_at, which driverService.setAvailability
   * (Phase 5) bumps on every ONLINE/OFFLINE transition. Not a dedicated
   * "went online at" column; see docs/matching-engine.md for the
   * known-imprecision this trades off against not adding one. */
  availableSince: Date;
}

/**
 * Section 8's eligibility list — APPROVED, ONLINE, recent valid location
 * — plus one more this phase's own design requires: not already holding
 * an open (OFFERED) offer for *any* ride. A driver mid-offer can't be
 * simultaneously offered a second, different ride; they can only ever
 * accept one at a time. `excludeDriverIds` additionally excludes drivers
 * already tried (in any status) for *this* ride during the current
 * matching attempt, so a single findMatch call never re-offers the same
 * candidate twice.
 */
export async function findEligibleDrivers(
  staleCutoff: Date,
  excludeDriverIds: string[],
): Promise<EligibleDriverRow[]> {
  const openOfferSubquery = db
    .select({ driverId: schema.rideRequests.driverId })
    .from(schema.rideRequests)
    .where(eq(schema.rideRequests.status, 'OFFERED'));

  const rows = await db
    .select({
      driverId: schema.driverProfiles.id,
      latitude: schema.driverLocations.latitude,
      longitude: schema.driverLocations.longitude,
      locationRecordedAt: schema.driverLocations.recordedAt,
      availableSince: schema.driverProfiles.updatedAt,
    })
    .from(schema.driverProfiles)
    .innerJoin(schema.driverLocations, eq(schema.driverLocations.driverId, schema.driverProfiles.id))
    .where(
      and(
        eq(schema.driverProfiles.onboardingStatus, 'APPROVED'),
        eq(schema.driverProfiles.availabilityStatus, 'ONLINE'),
        gte(schema.driverLocations.recordedAt, staleCutoff),
        notInArray(schema.driverProfiles.id, openOfferSubquery),
        excludeDriverIds.length > 0
          ? notInArray(schema.driverProfiles.id, excludeDriverIds)
          : undefined,
      ),
    );

  return rows;
}

/** Every driverId who has ever been offered this ride (any status) —
 * used to exclude already-tried candidates from a subsequent search
 * within the same matching attempt. */
export async function findTriedDriverIdsForRide(rideId: string): Promise<string[]> {
  const rows = await db
    .select({ driverId: schema.rideRequests.driverId })
    .from(schema.rideRequests)
    .where(eq(schema.rideRequests.rideId, rideId));
  return rows.map((row) => row.driverId);
}

/**
 * `undefined` (not a throw) means this specific driver lost a race with
 * a *different*, concurrent, independent matching attempt that offered
 * them a moment earlier — `ride_requests_one_open_offer_per_driver_key`
 * (Phase 21) is what actually makes that impossible to miss; the read
 * this function's own caller did just before calling it
 * (findEligibleDrivers) is not itself atomic with this insert, so two
 * concurrent attempts can both see the same driver as free. The caller
 * treats this exactly like the driver was never eligible in the first
 * place — try the next-ranked candidate, not an error.
 */
export async function createOffer(
  rideId: string,
  driverId: string,
  expiresAt: Date,
): Promise<RideRequestRow | undefined> {
  try {
    const [row] = await db
      .insert(schema.rideRequests)
      .values({ rideId, driverId, status: 'OFFERED', expiresAt })
      .returning();
    if (!row) throw new Error('Failed to create ride offer');
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'ride_requests_one_open_offer_per_driver_key')) {
      return undefined;
    }
    throw error;
  }
}

export async function findRideRequestById(id: string): Promise<RideRequestRow | undefined> {
  const [row] = await db.select().from(schema.rideRequests).where(eq(schema.rideRequests.id, id)).limit(1);
  return row;
}

/** The ride's currently-open (OFFERED) offer, if any — a ride has at
 * most one at a time by construction (this phase always waits for a
 * response/timeout before creating the next one). */
export async function findOpenOfferForRide(rideId: string): Promise<RideRequestRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')))
    .limit(1);
  return row;
}

/** The driver's currently-open (OFFERED) offer, if any — used by
 * GET /drivers/me/offer. A driver can hold at most one open offer at a
 * time (see findEligibleDrivers's exclusion of drivers already holding
 * one), so this is a single row, not a list. */
export async function findOpenOfferForDriver(driverId: string): Promise<RideRequestRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.driverId, driverId), eq(schema.rideRequests.status, 'OFFERED')))
    .limit(1);
  return row;
}

/** Every OFFERED row whose response timer has already elapsed —
 * candidates for the background sweep (src/index.ts) to expire. */
export async function findExpiredOpenOffers(now: Date): Promise<RideRequestRow[]> {
  return db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.status, 'OFFERED'), sql`${schema.rideRequests.expiresAt} < ${now}`));
}

/**
 * Atomically declines exactly one offer, conditional on it still being
 * OFFERED — a decline racing a sweep-driven expiry (or a duplicate
 * decline) safely no-ops on the loser instead of double-processing.
 */
export async function declineOfferAtomic(
  rideRequestId: string,
  driverId: string,
  now: Date,
): Promise<RideRequestRow | undefined> {
  const [row] = await db
    .update(schema.rideRequests)
    .set({ status: 'DECLINED', respondedAt: now })
    .where(
      and(
        eq(schema.rideRequests.id, rideRequestId),
        eq(schema.rideRequests.driverId, driverId),
        eq(schema.rideRequests.status, 'OFFERED'),
      ),
    )
    .returning();
  return row;
}

/** Same atomicity as declineOfferAtomic, driven by the sweep instead of
 * a driver response — conditional on both still being OFFERED *and* the
 * timer having actually elapsed, so a response that arrives in the same
 * instant the sweep runs can never lose to it. */
export async function expireOfferAtomic(
  rideRequestId: string,
  now: Date,
): Promise<RideRequestRow | undefined> {
  const [row] = await db
    .update(schema.rideRequests)
    .set({ status: 'EXPIRED', respondedAt: now })
    .where(
      and(
        eq(schema.rideRequests.id, rideRequestId),
        eq(schema.rideRequests.status, 'OFFERED'),
        sql`${schema.rideRequests.expiresAt} < ${now}`,
      ),
    )
    .returning();
  return row;
}

export { inArray };
