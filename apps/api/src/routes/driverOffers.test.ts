import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { createOffer } from '../repositories/matchingRepository';
import { sweepExpiredOffers } from '../services/matchingService';

const app = createApp();

const TEST_CONFIG = {
  baseFareCents: 250,
  perMileRateCents: 150,
  perMinuteRateCents: 25,
  minimumFareCents: 500,
  bookingFeeCents: 200,
  cancellationFeeCents: 500,
  platformCommissionPercentage: '20.00',
};

// ~111km per degree of latitude — close enough at any latitude to
// reason about "clearly inside tier X" / "clearly outside every tier"
// test fixtures; exact boundary math is already covered by
// packages/matching's own unit tests.
const DEG_PER_KM = 1 / 111;

let insertedConfigId: string;

beforeAll(async () => {
  await db
    .update(schema.pricingConfigs)
    .set({ active: false })
    .where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `matching-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await pool.end();
});

interface Point {
  latitude: number;
  longitude: number;
}

/**
 * Every test gets its own pickup point, chosen far enough from any other
 * point this function could plausibly return (tens of degrees — tens of
 * thousands of km) that no two tests' driver fixtures can ever fall
 * within each other's widest (15km) search radius, regardless of
 * execution order. Necessary because these tests share one real
 * database with no per-test reset — a driver a prior test left
 * ONLINE + APPROVED with a fresh location is a real candidate for any
 * later ride whose pickup happens to be nearby, and reusing one fixed
 * pickup coordinate across tests (as rides.test.ts does, safely, only
 * because it never makes any driver eligible) would make this file's
 * results depend on run order.
 */
function uniquePickup(): Point {
  return {
    latitude: Math.random() * 140 - 70, // -70..70
    longitude: Math.random() * 340 - 170, // -170..170
  };
}

function destinationNear(pickup: Point): Point {
  return { latitude: pickup.latitude - 0.01, longitude: pickup.longitude };
}

async function registerPassenger(): Promise<string> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-match-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Match',
      lastName: 'Passenger',
    });
  return response.body.data.tokens.accessToken as string;
}

interface RegisteredDriver {
  accessToken: string;
  userId: string;
  driverProfileId: string;
}

async function registerDriver(): Promise<RegisteredDriver> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-match-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Match',
      lastName: 'Driver',
      licenseNumber: `DL-${randomUUID()}`,
      licenseState: 'CA',
    });
  const accessToken = response.body.data.tokens.accessToken as string;
  const userId = response.body.data.user.id as string;

  const [profile] = await db
    .select({ id: schema.driverProfiles.id })
    .from(schema.driverProfiles)
    .where(eq(schema.driverProfiles.userId, userId))
    .limit(1);
  if (!profile) throw new Error('Failed to look up newly registered driver profile');

  return { accessToken, userId, driverProfileId: profile.id };
}

/** Directly promotes a driver to APPROVED + ONLINE and gives it a fresh
 * location near `pickup` — there is no public API for approval
 * (Phase 14), and forcing both onboarding + availability atomically is
 * simpler than round-tripping through PATCH /drivers/me/availability
 * for every fixture. */
async function makeEligible(
  driverProfileId: string,
  pickup: Point,
  options: { offsetKm?: number; recordedAt?: Date } = {},
): Promise<void> {
  const offsetKm = options.offsetKm ?? 0;
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
    .where(eq(schema.driverProfiles.id, driverProfileId));

  await db.insert(schema.driverLocations).values({
    driverId: driverProfileId,
    latitude: pickup.latitude + offsetKm * DEG_PER_KM,
    longitude: pickup.longitude,
    recordedAt: options.recordedAt ?? new Date(),
  });
}

async function registerEligibleDriver(pickup: Point, offsetKm = 0): Promise<RegisteredDriver> {
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup, { offsetKm });
  return driver;
}

function rideRequestBody(pickup: Point, overrides: Record<string, unknown> = {}) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function requestRide(passengerToken: string, pickup: Point): Promise<{ id: string; status: string }> {
  const response = await request(app)
    .post('/rides')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send(rideRequestBody(pickup));
  expect(response.status).toBe(201);
  return response.body.data;
}

async function openOffersForRide(rideId: string) {
  return db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
}

describe('Matching engine (Phase 8)', () => {
  it('offers a newly requested ride to the closest eligible driver', async () => {
    const pickup = uniquePickup();
    const passengerToken = await registerPassenger();
    const near = await registerEligibleDriver(pickup, 1);
    const far = await registerEligibleDriver(pickup, 4);

    const ride = await requestRide(passengerToken, pickup);

    const offers = await openOffersForRide(ride.id);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driverId).toBe(near.driverProfileId);
    expect(offers[0]?.driverId).not.toBe(far.driverProfileId);
  });

  it('leaves the ride SEARCHING_DRIVER with no offer when no driver is eligible', async () => {
    const pickup = uniquePickup();
    const passengerToken = await registerPassenger();
    // An OFFLINE driver (never made eligible) plus one whose location is
    // outside every search radius tier (default widest is 15km).
    await registerDriver();
    await registerEligibleDriver(pickup, 20);

    const ride = await requestRide(passengerToken, pickup);

    expect(ride.status).toBe('SEARCHING_DRIVER');
    expect(await openOffersForRide(ride.id)).toHaveLength(0);
  });

  it('excludes a driver whose location is stale', async () => {
    const pickup = uniquePickup();
    const passengerToken = await registerPassenger();
    const driver = await registerDriver();
    await makeEligible(driver.driverProfileId, pickup, {
      offsetKm: 1,
      recordedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes old
    });

    const ride = await requestRide(passengerToken, pickup);

    expect(await openOffersForRide(ride.id)).toHaveLength(0);
  });

  it('excludes a driver who already holds an open offer for a different ride', async () => {
    const pickup = uniquePickup();
    const passengerToken = await registerPassenger();
    const driver = await registerEligibleDriver(pickup, 1);

    // Give this driver a pre-existing open offer for some other ride,
    // simulating them already being mid-offer elsewhere.
    const otherRide = await requestRide(await registerPassenger(), uniquePickup());
    await createOffer(otherRide.id, driver.driverProfileId, new Date(Date.now() + 60_000));

    const ride = await requestRide(passengerToken, pickup);

    expect(await openOffersForRide(ride.id)).toHaveLength(0);
  });

  describe('GET /drivers/me/offer', () => {
    it('returns null when the driver has no open offer', async () => {
      const driver = await registerEligibleDriver(uniquePickup(), 1);

      const response = await request(app)
        .get('/drivers/me/offer')
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });

    it('returns the open offer with ride details', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const driver = await registerEligibleDriver(pickup, 1);
      const ride = await requestRide(passengerToken, pickup);

      const response = await request(app)
        .get('/drivers/me/offer')
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        ride: { id: ride.id, status: 'SEARCHING_DRIVER' },
      });
      expect(typeof response.body.data.id).toBe('string');
      expect(response.body.data.expiresAt).toBeDefined();
    });
  });

  describe('accept', () => {
    it('assigns the ride to the accepting driver and flips them to BUSY', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const driver = await registerEligibleDriver(pickup, 1);
      const ride = await requestRide(passengerToken, pickup);

      const offerResponse = await request(app)
        .get('/drivers/me/offer')
        .set('Authorization', `Bearer ${driver.accessToken}`);
      const rideRequestId = offerResponse.body.data.id as string;

      const acceptResponse = await request(app)
        .post(`/drivers/me/offer/${rideRequestId}/accept`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.data).toMatchObject({ id: ride.id, status: 'DRIVER_ASSIGNED' });

      const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, ride.id));
      expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
      expect(rideRow?.driverId).toBe(driver.driverProfileId);

      const [driverRow] = await db
        .select()
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.id, driver.driverProfileId));
      expect(driverRow?.availabilityStatus).toBe('BUSY');

      const [requestRow] = await db
        .select()
        .from(schema.rideRequests)
        .where(eq(schema.rideRequests.id, rideRequestId));
      expect(requestRow?.status).toBe('ACCEPTED');
    });

    it('rejects accepting an offer that was not made to the caller', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const offeredDriver = await registerEligibleDriver(pickup, 1);
      const otherDriver = await registerDriver();
      const ride = await requestRide(passengerToken, pickup);

      const offerResponse = await request(app)
        .get('/drivers/me/offer')
        .set('Authorization', `Bearer ${offeredDriver.accessToken}`);
      const rideRequestId = offerResponse.body.data.id as string;

      const response = await request(app)
        .post(`/drivers/me/offer/${rideRequestId}/accept`)
        .set('Authorization', `Bearer ${otherDriver.accessToken}`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');

      const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, ride.id));
      expect(rideRow?.status).toBe('SEARCHING_DRIVER');
    });

    it('rejects accepting an offer that no longer exists with 409, not a 500', async () => {
      const driver = await registerEligibleDriver(uniquePickup(), 1);

      const response = await request(app)
        .post(`/drivers/me/offer/${randomUUID()}/accept`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(response.status).toBe(409);
    });
  });

  describe('decline', () => {
    it('advances matching to the next candidate after a decline', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const closest = await registerEligibleDriver(pickup, 1);
      const nextClosest = await registerEligibleDriver(pickup, 2);
      const ride = await requestRide(passengerToken, pickup);

      const firstOffers = await openOffersForRide(ride.id);
      expect(firstOffers[0]?.driverId).toBe(closest.driverProfileId);
      const firstRideRequestId = firstOffers[0]?.id as string;

      const declineResponse = await request(app)
        .post(`/drivers/me/offer/${firstRideRequestId}/decline`)
        .set('Authorization', `Bearer ${closest.accessToken}`);
      expect(declineResponse.status).toBe(200);

      const [declinedRow] = await db
        .select()
        .from(schema.rideRequests)
        .where(eq(schema.rideRequests.id, firstRideRequestId));
      expect(declinedRow?.status).toBe('DECLINED');

      const secondOffers = await openOffersForRide(ride.id);
      expect(secondOffers).toHaveLength(1);
      expect(secondOffers[0]?.driverId).toBe(nextClosest.driverProfileId);
    });

    it('leaves the ride SEARCHING_DRIVER with no new offer when every candidate has declined', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const onlyDriver = await registerEligibleDriver(pickup, 1);
      const ride = await requestRide(passengerToken, pickup);

      const [offer] = await openOffersForRide(ride.id);
      await request(app)
        .post(`/drivers/me/offer/${offer?.id}/decline`)
        .set('Authorization', `Bearer ${onlyDriver.accessToken}`);

      expect(await openOffersForRide(ride.id)).toHaveLength(0);
      const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, ride.id));
      expect(rideRow?.status).toBe('SEARCHING_DRIVER');
    });
  });

  describe('timeout / background sweep', () => {
    it('sweepExpiredOffers expires a timed-out offer and advances to the next candidate', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const timedOut = await registerEligibleDriver(pickup, 1);
      const nextClosest = await registerEligibleDriver(pickup, 2);
      const ride = await requestRide(passengerToken, pickup);

      const [offer] = await openOffersForRide(ride.id);
      expect(offer?.driverId).toBe(timedOut.driverProfileId);

      // Back-date the response timer instead of waiting on it in real
      // time — sweepExpiredOffers is called directly here because it has
      // no HTTP surface of its own (src/index.ts's setInterval is the
      // only production caller; see docs/matching-engine.md).
      await db
        .update(schema.rideRequests)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.rideRequests.id, offer!.id));

      const expiredCount = await sweepExpiredOffers();
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const [expiredRow] = await db
        .select()
        .from(schema.rideRequests)
        .where(eq(schema.rideRequests.id, offer!.id));
      expect(expiredRow?.status).toBe('EXPIRED');

      const newOffers = await openOffersForRide(ride.id);
      expect(newOffers).toHaveLength(1);
      expect(newOffers[0]?.driverId).toBe(nextClosest.driverProfileId);
    });
  });

  describe('concurrent acceptance — exactly one winner', () => {
    it('two drivers accepting simultaneously results in exactly one winner', async () => {
      const pickup = uniquePickup();
      const passengerToken = await registerPassenger();
      const driverA = await registerEligibleDriver(pickup, 1);
      const driverB = await registerDriver();
      await makeEligible(driverB.driverProfileId, pickup, { offsetKm: 1 });

      const ride = await requestRide(passengerToken, pickup);

      // Real matching only ever leaves one OFFERED row per ride — this
      // directly constructs the two-drivers-racing-for-one-ride scenario
      // the spec describes, exercising the same atomic accept transaction
      // that would otherwise be reached one decline/timeout at a time.
      const [existingOffer] = await openOffersForRide(ride.id);
      // createOffer can only return undefined (Phase 21) when the driver
      // already holds a different open offer elsewhere — driverA/driverB
      // are freshly registered just above and hold none, so both calls
      // are guaranteed to succeed here; the `!` reflects that guarantee.
      const requestA =
        existingOffer?.driverId === driverA.driverProfileId
          ? existingOffer
          : (await createOffer(ride.id, driverA.driverProfileId, new Date(Date.now() + 60_000)))!;
      const requestB = (await createOffer(ride.id, driverB.driverProfileId, new Date(Date.now() + 60_000)))!;

      const [responseA, responseB] = await Promise.all([
        request(app)
          .post(`/drivers/me/offer/${requestA.id}/accept`)
          .set('Authorization', `Bearer ${driverA.accessToken}`),
        request(app)
          .post(`/drivers/me/offer/${requestB.id}/accept`)
          .set('Authorization', `Bearer ${driverB.accessToken}`),
      ]);

      const statuses = [responseA.status, responseB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, ride.id));
      expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
      expect([driverA.driverProfileId, driverB.driverProfileId]).toContain(rideRow?.driverId);

      const finalRequests = await db
        .select()
        .from(schema.rideRequests)
        .where(eq(schema.rideRequests.rideId, ride.id));
      const accepted = finalRequests.filter((row) => row.status === 'ACCEPTED');
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.driverId).toBe(rideRow?.driverId);
      // Every non-winner is EXPIRED — never left OFFERED, never ACCEPTED.
      for (const row of finalRequests) {
        if (row.status !== 'ACCEPTED') expect(row.status).toBe('EXPIRED');
      }
    });

    it(
      'stays exactly one winner with 50 simulated drivers racing to accept the same ride',
      async () => {
        const pickup = uniquePickup();
        const passengerToken = await registerPassenger();
        const ride = await requestRide(passengerToken, pickup);

        // Clear whatever real matching already offered — this test wants
        // full control over exactly 50 concurrent OFFERED candidates.
        await db
          .update(schema.rideRequests)
          .set({ status: 'EXPIRED' })
          .where(eq(schema.rideRequests.rideId, ride.id));

        const drivers = await Promise.all(
          Array.from({ length: 50 }, (_, i) => registerEligibleDriver(pickup, 1 + i * 0.1)),
        );

        const offers = await Promise.all(
          drivers.map((driver) => createOffer(ride.id, driver.driverProfileId, new Date(Date.now() + 60_000))),
        );

        const responses = await Promise.all(
          drivers.map((driver, index) =>
            request(app)
              .post(`/drivers/me/offer/${offers[index]!.id}/accept`)
              .set('Authorization', `Bearer ${driver.accessToken}`),
          ),
        );

        const successCount = responses.filter((response) => response.status === 200).length;
        const conflictCount = responses.filter((response) => response.status === 409).length;
        expect(successCount).toBe(1);
        expect(conflictCount).toBe(49);

        const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, ride.id));
        expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
        expect(rideRow?.driverId).not.toBeNull();

        const finalRequests = await db
          .select()
          .from(schema.rideRequests)
          .where(eq(schema.rideRequests.rideId, ride.id));
        const accepted = finalRequests.filter((row) => row.status === 'ACCEPTED');
        expect(accepted).toHaveLength(1);
        expect(accepted[0]?.driverId).toBe(rideRow?.driverId);
        for (const row of finalRequests) {
          if (row.status !== 'ACCEPTED') expect(row.status).toBe('EXPIRED');
        }

        const [winnerProfile] = await db
          .select()
          .from(schema.driverProfiles)
          .where(eq(schema.driverProfiles.id, rideRow!.driverId!));
        expect(winnerProfile?.availabilityStatus).toBe('BUSY');
      },
      60_000,
    );
  });

  /**
   * PHASE 21: a distinct concurrency dimension from "several drivers
   * racing to accept the same offer" above — several *different*
   * passengers racing to request rides concurrently against a shared,
   * deliberately-undersized pool of eligible drivers. Each ride request
   * runs its own independent `findEligibleDrivers` read followed by its
   * own `createOffer` write (see matchingService.findAndOfferNextCandidate);
   * nothing coordinates across these concurrent, unrelated requests
   * beyond the eligibility query's own `notInArray` exclusion of
   * already-offered drivers. Phase 19's load simulator surfaced exactly
   * this dynamic under real concurrent load (49/50 requests matched,
   * the 50th legitimately finding zero eligible candidates at its own
   * snapshot read — see docs/simulation-results.md) — this test turns
   * that one-off observation into a permanent, always-run regression
   * check of the invariant that actually has to hold under this kind of
   * race: no driver is ever offered two rides at once, and every
   * request still gets its own, single ride row regardless of how the
   * matching race resolves.
   */
  describe('concurrent ride requests — no double-assignment across independent rides', () => {
    it('never offers one driver to two different rides at once, even when demand exceeds supply', async () => {
      const pickup = uniquePickup();
      const driverCount = 5;
      const passengerCount = 8; // deliberately more requests than drivers

      const drivers = await Promise.all(
        Array.from({ length: driverCount }, (_, i) => registerEligibleDriver(pickup, 1 + i * 0.1)),
      );
      const passengerTokens = await Promise.all(
        Array.from({ length: passengerCount }, () => registerPassenger()),
      );

      const responses = await Promise.all(
        passengerTokens.map((token) =>
          request(app).post('/rides').set('Authorization', `Bearer ${token}`).send(rideRequestBody(pickup)),
        ),
      );

      // Ride creation itself is unaffected by matching contention —
      // finding no (or a contended) candidate is a valid outcome
      // matchingService handles internally, never a failed request.
      for (const response of responses) {
        expect(response.status).toBe(201);
      }
      const rideIds = responses.map((r) => r.body.data.id as string);
      expect(new Set(rideIds).size).toBe(passengerCount); // every request got its own, distinct ride row

      const offeredRows = await db
        .select({ rideId: schema.rideRequests.rideId, driverId: schema.rideRequests.driverId })
        .from(schema.rideRequests)
        .where(
          and(inArray(schema.rideRequests.rideId, rideIds), eq(schema.rideRequests.status, 'OFFERED')),
        );

      // The actual invariant under test: at most one open offer per
      // driver, no matter how many of these requests raced each other
      // for the same driver pool.
      const offeredDriverIds = offeredRows.map((row) => row.driverId);
      expect(new Set(offeredDriverIds).size).toBe(offeredDriverIds.length);
      expect(offeredRows.length).toBeLessThanOrEqual(driverCount);
      expect(offeredRows.length).toBeGreaterThan(0); // the pool wasn't somehow left entirely unused

      // Every offered driver really is one of this test's own drivers —
      // no cross-test bleed (uniquePickup's own isolation guarantee,
      // re-verified here as this test's actual assertion, not just
      // assumed).
      const ownDriverIds = new Set(drivers.map((d) => d.driverProfileId));
      for (const driverId of offeredDriverIds) {
        expect(ownDriverIds.has(driverId)).toBe(true);
      }
    });
  });
});
