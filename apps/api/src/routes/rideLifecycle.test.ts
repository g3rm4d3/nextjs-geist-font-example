import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { cancelRideBySystem } from '../services/rideLifecycleService';

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

let insertedConfigId: string;

beforeAll(async () => {
  await db
    .update(schema.pricingConfigs)
    .set({ active: false })
    .where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `lifecycle-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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

/** Same reasoning as driverOffers.test.ts: a unique pickup per test so
 * drivers one test makes ONLINE + located can never be candidates in a
 * later test that happens to request a ride nearby. */
function uniquePickup(): Point {
  return { latitude: Math.random() * 140 - 70, longitude: Math.random() * 340 - 170 };
}

function destinationNear(pickup: Point): Point {
  return { latitude: pickup.latitude - 0.01, longitude: pickup.longitude };
}

async function registerPassenger(): Promise<{ accessToken: string; userId: string }> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-lifecycle-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Lifecycle',
      lastName: 'Passenger',
    });
  return {
    accessToken: response.body.data.tokens.accessToken as string,
    userId: response.body.data.user.id as string,
  };
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
      email: `driver-lifecycle-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Lifecycle',
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

async function makeEligible(driverProfileId: string, pickup: Point): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
    .where(eq(schema.driverProfiles.id, driverProfileId));

  await db.insert(schema.driverLocations).values({
    driverId: driverProfileId,
    latitude: pickup.latitude + 0.005, // ~0.5km — comfortably inside the 2km tier
    longitude: pickup.longitude,
    recordedAt: new Date(),
  });
}

async function registerEligibleDriver(pickup: Point): Promise<RegisteredDriver> {
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup);
  return driver;
}

function rideRequestBody(pickup: Point) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
  };
}

/** Registers a passenger + one eligible driver, requests a ride (which
 * auto-matches to that driver via Phase 8), and accepts the resulting
 * offer — leaving the ride at DRIVER_ASSIGNED, the entry point for every
 * Phase 9 lifecycle test below. */
async function setUpAssignedRide(): Promise<{
  rideId: string;
  passenger: { accessToken: string; userId: string };
  driver: RegisteredDriver;
}> {
  const pickup = uniquePickup();
  const passenger = await registerPassenger();
  const driver = await registerEligibleDriver(pickup);

  const rideResponse = await request(app)
    .post('/rides')
    .set('Authorization', `Bearer ${passenger.accessToken}`)
    .send(rideRequestBody(pickup));
  expect(rideResponse.status).toBe(201);
  const rideId = rideResponse.body.data.id as string;

  const [offer] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
  expect(offer).toBeDefined();

  const acceptResponse = await request(app)
    .post(`/drivers/me/offer/${offer!.id}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`);
  expect(acceptResponse.status).toBe(200);
  expect(acceptResponse.body.data.status).toBe('DRIVER_ASSIGNED');

  return { rideId, passenger, driver };
}

async function rideEventsFor(rideId: string) {
  return db
    .select({
      previousStatus: schema.rideEvents.previousStatus,
      newStatus: schema.rideEvents.newStatus,
      actorType: schema.rideEvents.actorType,
    })
    .from(schema.rideEvents)
    .where(eq(schema.rideEvents.rideId, rideId))
    .orderBy(schema.rideEvents.createdAt);
}

describe('Ride lifecycle (Phase 9)', () => {
  it('walks a ride through the full lifecycle to COMPLETED, logging every transition', async () => {
    const { rideId, driver } = await setUpAssignedRide();
    const auth = { Authorization: `Bearer ${driver.accessToken}` };

    const enRoute = await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
    expect(enRoute.status).toBe(200);
    expect(enRoute.body.data.status).toBe('DRIVER_EN_ROUTE');

    const arrived = await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.status).toBe('DRIVER_ARRIVED');

    const pickedUp = await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
    expect(pickedUp.status).toBe(200);
    expect(pickedUp.body.data.status).toBe('PASSENGER_ONBOARD');

    const started = await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const completed = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.finalFareCents).toBeGreaterThanOrEqual(TEST_CONFIG.minimumFareCents);
    expect(completed.body.data.actualDistanceMeters).toBeGreaterThan(0);
    expect(completed.body.data.actualDurationSeconds).toBeGreaterThan(0);

    const events = await rideEventsFor(rideId);
    expect(events).toEqual([
      { previousStatus: null, newStatus: 'REQUESTED', actorType: 'PASSENGER' },
      { previousStatus: 'REQUESTED', newStatus: 'SEARCHING_DRIVER', actorType: 'SYSTEM' },
      { previousStatus: 'SEARCHING_DRIVER', newStatus: 'DRIVER_ASSIGNED', actorType: 'DRIVER' },
      { previousStatus: 'DRIVER_ASSIGNED', newStatus: 'DRIVER_EN_ROUTE', actorType: 'DRIVER' },
      { previousStatus: 'DRIVER_EN_ROUTE', newStatus: 'DRIVER_ARRIVED', actorType: 'DRIVER' },
      { previousStatus: 'DRIVER_ARRIVED', newStatus: 'PASSENGER_ONBOARD', actorType: 'DRIVER' },
      { previousStatus: 'PASSENGER_ONBOARD', newStatus: 'IN_PROGRESS', actorType: 'DRIVER' },
      { previousStatus: 'IN_PROGRESS', newStatus: 'COMPLETED', actorType: 'DRIVER' },
    ]);

    // The driver is free again after completion, not stuck BUSY forever.
    const [driverRow] = await db
      .select()
      .from(schema.driverProfiles)
      .where(eq(schema.driverProfiles.id, driver.driverProfileId));
    expect(driverRow?.availabilityStatus).toBe('ONLINE');
  });

  it('rejects skipping a stage (DRIVER_ASSIGNED straight to arrived)', async () => {
    const { rideId, driver } = await setUpAssignedRide();

    const response = await request(app)
      .post(`/drivers/me/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driver.accessToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');

    const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
  });

  it('driver cannot complete a ride that never started', async () => {
    const { rideId, driver } = await setUpAssignedRide();
    const auth = { Authorization: `Bearer ${driver.accessToken}` };

    await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);

    // Still PASSENGER_ONBOARD — startTrip (IN_PROGRESS) was never called.
    const response = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);

    expect(response.status).toBe(409);
    const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideRow?.status).toBe('PASSENGER_ONBOARD');
    expect(rideRow?.completedAt).toBeNull();
  });

  it("driver cannot operate another driver's ride", async () => {
    const { rideId } = await setUpAssignedRide();
    const otherDriver = await registerDriver();

    const response = await request(app)
      .post(`/drivers/me/rides/${rideId}/en-route`)
      .set('Authorization', `Bearer ${otherDriver.accessToken}`);

    expect(response.status).toBe(404);

    const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
  });

  it("an unrelated driver cannot cancel or read someone else's ride either", async () => {
    const { rideId } = await setUpAssignedRide();
    const otherDriver = await registerDriver();
    const auth = { Authorization: `Bearer ${otherDriver.accessToken}` };

    const cancelResponse = await request(app)
      .post(`/drivers/me/rides/${rideId}/cancel`)
      .set(auth)
      .send({});
    expect(cancelResponse.status).toBe(404);

    const getResponse = await request(app).get(`/drivers/me/rides/${rideId}`).set(auth);
    expect(getResponse.status).toBe(404);
  });

  it('passenger cannot arbitrarily modify ride state (role-gated off every forward endpoint)', async () => {
    const { rideId, passenger } = await setUpAssignedRide();
    const auth = { Authorization: `Bearer ${passenger.accessToken}` };

    for (const action of ['en-route', 'arrived', 'picked-up', 'start', 'complete']) {
      const response = await request(app).post(`/drivers/me/rides/${rideId}/${action}`).set(auth);
      expect(response.status).toBe(403);
    }

    const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideRow?.status).toBe('DRIVER_ASSIGNED');
  });

  describe('GET /rides/:id and GET /drivers/me/rides/:id', () => {
    it('lets the passenger and the assigned driver read the ride, but no one else', async () => {
      const { rideId, passenger, driver } = await setUpAssignedRide();
      const otherPassenger = await registerPassenger();

      const passengerRead = await request(app)
        .get(`/rides/${rideId}`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);
      expect(passengerRead.status).toBe(200);
      expect(passengerRead.body.data.status).toBe('DRIVER_ASSIGNED');

      const driverRead = await request(app)
        .get(`/drivers/me/rides/${rideId}`)
        .set('Authorization', `Bearer ${driver.accessToken}`);
      expect(driverRead.status).toBe(200);

      const wrongPassengerRead = await request(app)
        .get(`/rides/${rideId}`)
        .set('Authorization', `Bearer ${otherPassenger.accessToken}`);
      expect(wrongPassengerRead.status).toBe(404);
    });
  });

  describe('cancellation', () => {
    it('lets a passenger cancel before a driver is assigned', async () => {
      const pickup = uniquePickup();
      const passenger = await registerPassenger();

      const rideResponse = await request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send(rideRequestBody(pickup));
      const rideId = rideResponse.body.data.id as string;

      const cancelResponse = await request(app)
        .post(`/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send({ reason: 'Changed my mind' });

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.data.status).toBe('CANCELLED_BY_PASSENGER');
      expect(cancelResponse.body.data.cancellationReason).toBe('Changed my mind');
    });

    it('lets a passenger cancel an assigned-but-not-yet-onboard ride, freeing the driver', async () => {
      const { rideId, passenger, driver } = await setUpAssignedRide();

      const response = await request(app)
        .post(`/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('CANCELLED_BY_PASSENGER');

      const [driverRow] = await db
        .select()
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.id, driver.driverProfileId));
      expect(driverRow?.availabilityStatus).toBe('ONLINE');
    });

    it('rejects a passenger cancelling once the passenger is onboard', async () => {
      const { rideId, passenger, driver } = await setUpAssignedRide();
      const driverAuth = { Authorization: `Bearer ${driver.accessToken}` };

      await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(driverAuth);

      const response = await request(app)
        .post(`/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send({});

      expect(response.status).toBe(409);
      const [rideRow] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId));
      expect(rideRow?.status).toBe('PASSENGER_ONBOARD');
    });

    it('rejects a passenger cancelling a completed ride', async () => {
      const { rideId, passenger, driver } = await setUpAssignedRide();
      const driverAuth = { Authorization: `Bearer ${driver.accessToken}` };

      await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/start`).set(driverAuth);
      await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(driverAuth);

      const response = await request(app)
        .post(`/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send({});

      expect(response.status).toBe(409);
    });

    it('lets a driver cancel an assigned ride, freeing themselves back to ONLINE', async () => {
      const { rideId, driver } = await setUpAssignedRide();

      const response = await request(app)
        .post(`/drivers/me/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ reason: 'Vehicle issue' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('CANCELLED_BY_DRIVER');

      const [driverRow] = await db
        .select()
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.id, driver.driverProfileId));
      expect(driverRow?.availabilityStatus).toBe('ONLINE');
    });

    it("a passenger cannot cancel someone else's ride", async () => {
      const { rideId } = await setUpAssignedRide();
      const otherPassenger = await registerPassenger();

      const response = await request(app)
        .post(`/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${otherPassenger.accessToken}`)
        .send({});

      expect(response.status).toBe(404);
    });

    /** CANCELLED_BY_SYSTEM has no HTTP route in Stage 1 (see
     * docs/ride-lifecycle.md's known limitations — nothing automatically
     * triggers it) but the function itself is real and tested directly,
     * so the enum value is an actually-reachable code path, not a schema
     * value nothing can ever produce. */
    it('cancelRideBySystem produces a real CANCELLED_BY_SYSTEM ride, releasing the driver', async () => {
      const { rideId, driver } = await setUpAssignedRide();

      const ride = await cancelRideBySystem(rideId, 'No response from driver');

      expect(ride.status).toBe('CANCELLED_BY_SYSTEM');
      expect(ride.cancellationReason).toBe('No response from driver');

      const [driverRow] = await db
        .select()
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.id, driver.driverProfileId));
      expect(driverRow?.availabilityStatus).toBe('ONLINE');
    });
  });
});
