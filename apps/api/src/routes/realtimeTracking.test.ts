import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { db } from '../db/client';
import { pool } from '../db/pool';

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
    .values({ name: `tracking-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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
      email: `passenger-tracking-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Track',
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
      email: `driver-tracking-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Track',
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
    latitude: pickup.latitude + 0.005,
    longitude: pickup.longitude,
    recordedAt: new Date(),
  });
}

function rideRequestBody(pickup: Point) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
  };
}

async function createAdminToken(): Promise<string> {
  const email = `admin-tracking-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role: 'ADMIN' });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  return response.body.data.tokens.accessToken as string;
}

/** Registers a passenger + one eligible driver, requests a ride (auto-
 * matched via Phase 8), and accepts it — leaving the ride at
 * DRIVER_ASSIGNED, same entry point rideLifecycle.test.ts uses. */
async function setUpAssignedRide(): Promise<{
  rideId: string;
  pickup: Point;
  passenger: { accessToken: string; userId: string };
  driver: RegisteredDriver;
}> {
  const pickup = uniquePickup();
  const passenger = await registerPassenger();
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup);

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

  return { rideId, pickup, passenger, driver };
}

/** Drives an assigned ride all the way to IN_PROGRESS. */
async function advanceToInProgress(driverAccessToken: string, rideId: string): Promise<void> {
  const auth = { Authorization: `Bearer ${driverAccessToken}` };
  await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
  const started = await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
  expect(started.status).toBe(200);
  expect(started.body.data.status).toBe('IN_PROGRESS');
}

async function pingLocation(driverAccessToken: string, point: Point) {
  return request(app)
    .post('/drivers/me/location')
    .set('Authorization', `Bearer ${driverAccessToken}`)
    .send({ latitude: point.latitude, longitude: point.longitude });
}

async function routeSamplesFor(rideId: string) {
  return db
    .select()
    .from(schema.rideLocationSamples)
    .where(eq(schema.rideLocationSamples.rideId, rideId))
    .orderBy(schema.rideLocationSamples.recordedAt);
}

describe('Realtime ride experience (Phase 10)', () => {
  describe('route location samples', () => {
    it('records a sample on the first location ping once a ride is IN_PROGRESS', async () => {
      const { rideId, pickup, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);

      const pingResponse = await pingLocation(driver.accessToken, pickup);
      expect(pingResponse.status).toBe(200);

      const samples = await routeSamplesFor(rideId);
      expect(samples).toHaveLength(1);
      expect(samples[0]?.latitude).toBeCloseTo(pickup.latitude, 5);
    });

    it('does not record a second sample within the configured sampling interval', async () => {
      const { rideId, pickup, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);

      await pingLocation(driver.accessToken, pickup);
      await pingLocation(driver.accessToken, { ...pickup, latitude: pickup.latitude + 0.001 });

      const samples = await routeSamplesFor(rideId);
      expect(samples).toHaveLength(1);
    });

    it('records a new sample once the sampling interval has elapsed', async () => {
      const { rideId, pickup, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);

      await pingLocation(driver.accessToken, pickup);
      const [firstSample] = await routeSamplesFor(rideId);
      expect(firstSample).toBeDefined();

      // Back-date instead of waiting on env.RIDE_LOCATION_SAMPLE_INTERVAL_MS
      // in real time — same reasoning as Phase 8's sweep tests.
      await db
        .update(schema.rideLocationSamples)
        .set({ recordedAt: new Date(Date.now() - env.RIDE_LOCATION_SAMPLE_INTERVAL_MS - 1000) })
        .where(eq(schema.rideLocationSamples.id, firstSample!.id));

      await pingLocation(driver.accessToken, { ...pickup, latitude: pickup.latitude + 0.001 });

      const samples = await routeSamplesFor(rideId);
      expect(samples).toHaveLength(2);
    });

    it('does not record samples while the ride is only DRIVER_EN_ROUTE, not yet IN_PROGRESS', async () => {
      const { rideId, pickup, driver } = await setUpAssignedRide();
      await request(app)
        .post(`/drivers/me/rides/${rideId}/en-route`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      await pingLocation(driver.accessToken, pickup);

      expect(await routeSamplesFor(rideId)).toHaveLength(0);
    });
  });

  describe('actual distance at completion', () => {
    it('computes actualDistanceMeters from recorded route samples when at least two exist', async () => {
      const { rideId, pickup, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);

      // Directly insert two samples ~1.11km apart (0.01 deg latitude) so
      // the expected haversine sum is independently computable, rather
      // than relying on the location-ping throttle in real time.
      await db.insert(schema.rideLocationSamples).values([
        {
          rideId,
          latitude: pickup.latitude,
          longitude: pickup.longitude,
          recordedAt: new Date(Date.now() - 60_000),
        },
        {
          rideId,
          latitude: pickup.latitude + 0.01,
          longitude: pickup.longitude,
          recordedAt: new Date(),
        },
      ]);

      const completeResponse = await request(app)
        .post(`/drivers/me/rides/${rideId}/complete`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(completeResponse.status).toBe(200);
      // ~111.19km per degree of latitude — expect ~1112m, well outside
      // the pre-trip estimate (a straight line to a *different* point,
      // the ride's actual destination) to prove the samples were used.
      expect(completeResponse.body.data.actualDistanceMeters).toBeGreaterThan(1000);
      expect(completeResponse.body.data.actualDistanceMeters).toBeLessThan(1200);
    });

    it('falls back to the pre-trip estimate when fewer than two samples exist', async () => {
      const { rideId, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);

      expect(await routeSamplesFor(rideId)).toHaveLength(0);

      const [rideBeforeCompletion] = await db
        .select({ estimatedDistanceMeters: schema.rides.estimatedDistanceMeters })
        .from(schema.rides)
        .where(eq(schema.rides.id, rideId));

      const completeResponse = await request(app)
        .post(`/drivers/me/rides/${rideId}/complete`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.data.actualDistanceMeters).toBe(
        rideBeforeCompletion?.estimatedDistanceMeters,
      );
    });
  });

  describe('GET /rides/:id/driver', () => {
    it('returns null before a driver is assigned', async () => {
      const pickup = uniquePickup();
      const passenger = await registerPassenger();

      const rideResponse = await request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send(rideRequestBody(pickup));
      const rideId = rideResponse.body.data.id as string;

      const response = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });

    it('returns driver name, vehicle, location, and an ETA once assigned', async () => {
      const { rideId, pickup, passenger, driver } = await setUpAssignedRide();
      await pingLocation(driver.accessToken, pickup);

      const response = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ firstName: 'Track' });
      expect(response.body.data.location).toMatchObject({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      });
      expect(typeof response.body.data.estimatedArrivalSeconds).toBe('number');
    });

    it('returns null once the ride is completed', async () => {
      const { rideId, passenger, driver } = await setUpAssignedRide();
      await advanceToInProgress(driver.accessToken, rideId);
      await request(app)
        .post(`/drivers/me/rides/${rideId}/complete`)
        .set('Authorization', `Bearer ${driver.accessToken}`);

      const response = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });

    it('404s for a ride that is not the caller\'s', async () => {
      const { rideId } = await setUpAssignedRide();
      const otherPassenger = await registerPassenger();

      const response = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${otherPassenger.accessToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /admin/rides/active', () => {
    it('lists an active ride with passenger and driver names, excluding terminal rides', async () => {
      const { rideId } = await setUpAssignedRide();

      const completedSetup = await setUpAssignedRide();
      await advanceToInProgress(completedSetup.driver.accessToken, completedSetup.rideId);
      await request(app)
        .post(`/drivers/me/rides/${completedSetup.rideId}/complete`)
        .set('Authorization', `Bearer ${completedSetup.driver.accessToken}`);

      const adminToken = await createAdminToken();
      const response = await request(app)
        .get('/admin/rides/active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const rows = response.body.data as Array<{ id: string; driverName: string | null }>;

      const activeRow = rows.find((row) => row.id === rideId);
      expect(activeRow).toBeDefined();
      expect(activeRow?.driverName).toBe('Track Driver');

      const completedRow = rows.find((row) => row.id === completedSetup.rideId);
      expect(completedRow).toBeUndefined();
    });

    it('requires an admin role', async () => {
      const passenger = await registerPassenger();
      const response = await request(app)
        .get('/admin/rides/active')
        .set('Authorization', `Bearer ${passenger.accessToken}`);

      expect(response.status).toBe(403);
    });
  });
});
