import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
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
    .values({ name: `ratings-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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
      email: `passenger-ratings-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Ratings',
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
      email: `driver-ratings-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Ratings',
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

/** Registers a passenger + one eligible driver, requests a ride, accepts
 * the resulting offer, and walks the ride all the way through to
 * COMPLETED — the point at which Phase 13's ratings become legal. */
async function driveRideToCompleted(): Promise<{
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
  if (!offer) throw new Error('Expected a driver offer to have been created');

  await request(app)
    .post(`/drivers/me/offer/${offer.id}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`);

  const auth = { Authorization: `Bearer ${driver.accessToken}` };
  await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
  const completed = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);
  expect(completed.status).toBe(200);
  expect(completed.body.data.status).toBe('COMPLETED');

  return { rideId, passenger, driver };
}

async function getPassengerAggregate(
  userId: string,
): Promise<{ averageRating: string | null; ratingsCount: number }> {
  const [row] = await db
    .select({
      averageRating: schema.passengerProfiles.averageRating,
      ratingsCount: schema.passengerProfiles.ratingsCount,
    })
    .from(schema.passengerProfiles)
    .where(eq(schema.passengerProfiles.userId, userId));
  if (!row) throw new Error('Expected a passenger profile row');
  return row;
}

describe('Ratings (Phase 13)', () => {
  it('lets a passenger rate the driver after completion and recomputes the driver aggregate', async () => {
    const { rideId, passenger, driver } = await driveRideToCompleted();

    const response = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 5, comment: 'Great ride!' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      rideId,
      direction: 'PASSENGER_TO_DRIVER',
      stars: 5,
      comment: 'Great ride!',
    });

    const profileResponse = await request(app)
      .get('/drivers/me/profile')
      .set('Authorization', `Bearer ${driver.accessToken}`);
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.data.averageRating).toBe(5);
    expect(profileResponse.body.data.ratingsCount).toBe(1);
  });

  it('lets a driver rate the passenger after completion and recomputes the passenger aggregate', async () => {
    const { rideId, passenger, driver } = await driveRideToCompleted();

    const response = await request(app)
      .post(`/drivers/me/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ stars: 4 });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      rideId,
      direction: 'DRIVER_TO_PASSENGER',
      stars: 4,
      comment: null,
    });

    const aggregate = await getPassengerAggregate(passenger.userId);
    expect(Number(aggregate.averageRating)).toBe(4);
    expect(aggregate.ratingsCount).toBe(1);
  });

  it('computes a real average, not just the latest rating, across multiple rides', async () => {
    const first = await driveRideToCompleted();
    // Reuse the same driver for a second ride/rating so the average is
    // genuinely over two ratings, not one per driver.
    const secondPickup = uniquePickup();
    const passenger2 = await registerPassenger();
    // Driver already has a driver_locations row from the first ride
    // (unique per driver) — just move it near the second pickup and
    // make sure availability is still ONLINE, rather than re-inserting.
    await db
      .update(schema.driverProfiles)
      .set({ availabilityStatus: 'ONLINE' })
      .where(eq(schema.driverProfiles.id, first.driver.driverProfileId));
    await db
      .update(schema.driverLocations)
      .set({ latitude: secondPickup.latitude + 0.005, longitude: secondPickup.longitude })
      .where(eq(schema.driverLocations.driverId, first.driver.driverProfileId));

    const rideResponse = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${passenger2.accessToken}`)
      .send(rideRequestBody(secondPickup));
    const rideId2 = rideResponse.body.data.id as string;
    const [offer] = await db
      .select()
      .from(schema.rideRequests)
      .where(and(eq(schema.rideRequests.rideId, rideId2), eq(schema.rideRequests.status, 'OFFERED')));
    if (!offer) throw new Error('Expected a driver offer to have been created');
    const auth = { Authorization: `Bearer ${first.driver.accessToken}` };
    await request(app).post(`/drivers/me/offer/${offer.id}/accept`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId2}/en-route`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId2}/arrived`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId2}/picked-up`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId2}/start`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId2}/complete`).set(auth);

    await request(app)
      .post(`/rides/${first.rideId}/rating`)
      .set('Authorization', `Bearer ${first.passenger.accessToken}`)
      .send({ stars: 5 });
    await request(app)
      .post(`/rides/${rideId2}/rating`)
      .set('Authorization', `Bearer ${passenger2.accessToken}`)
      .send({ stars: 3 });

    const profileResponse = await request(app)
      .get('/drivers/me/profile')
      .set('Authorization', `Bearer ${first.driver.accessToken}`);
    expect(profileResponse.body.data.ratingsCount).toBe(2);
    expect(profileResponse.body.data.averageRating).toBe(4); // (5+3)/2
  });

  it('rejects rating a ride that has not completed', async () => {
    const pickup = uniquePickup();
    const passenger = await registerPassenger();
    const driver = await registerEligibleDriver(pickup);

    const rideResponse = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send(rideRequestBody(pickup));
    const rideId = rideResponse.body.data.id as string;
    const [offer] = await db
      .select()
      .from(schema.rideRequests)
      .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
    if (!offer) throw new Error('Expected a driver offer to have been created');
    await request(app)
      .post(`/drivers/me/offer/${offer.id}/accept`)
      .set('Authorization', `Bearer ${driver.accessToken}`);
    // Still DRIVER_ASSIGNED — nowhere near COMPLETED.

    const response = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 5 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a second rating in the same direction for the same ride', async () => {
    const { rideId, passenger } = await driveRideToCompleted();

    const first = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 5 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 2 });

    expect(second.status).toBe(409);

    // The first rating's stars must survive untouched.
    const [row] = await db
      .select()
      .from(schema.ratings)
      .where(and(eq(schema.ratings.rideId, rideId), eq(schema.ratings.direction, 'PASSENGER_TO_DRIVER')));
    expect(row?.stars).toBe(5);
  });

  it('rejects stars outside 1-5', async () => {
    const { rideId, passenger } = await driveRideToCompleted();

    const tooLow = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 0 });
    expect(tooLow.status).toBe(400);

    const tooHigh = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 6 });
    expect(tooHigh.status).toBe(400);
  });

  it("a passenger cannot rate or read another passenger's ride", async () => {
    const { rideId } = await driveRideToCompleted();
    const otherPassenger = await registerPassenger();

    const rateResponse = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${otherPassenger.accessToken}`)
      .send({ stars: 5 });
    expect(rateResponse.status).toBe(404);

    const readResponse = await request(app)
      .get(`/rides/${rideId}/ratings`)
      .set('Authorization', `Bearer ${otherPassenger.accessToken}`);
    expect(readResponse.status).toBe(404);
  });

  it("a driver cannot rate or read another driver's ride", async () => {
    const { rideId } = await driveRideToCompleted();
    const otherDriver = await registerDriver();

    const rateResponse = await request(app)
      .post(`/drivers/me/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${otherDriver.accessToken}`)
      .send({ stars: 5 });
    expect(rateResponse.status).toBe(404);

    const readResponse = await request(app)
      .get(`/drivers/me/rides/${rideId}/ratings`)
      .set('Authorization', `Bearer ${otherDriver.accessToken}`);
    expect(readResponse.status).toBe(404);
  });

  it('role-gates rating submission to the correct side', async () => {
    const { rideId, passenger, driver } = await driveRideToCompleted();

    const driverHittingPassengerRoute = await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ stars: 5 });
    expect(driverHittingPassengerRoute.status).toBe(403);

    const passengerHittingDriverRoute = await request(app)
      .post(`/drivers/me/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 5 });
    expect(passengerHittingDriverRoute.status).toBe(403);
  });

  describe('GET .../ratings', () => {
    it('shows both directions once both parties have rated, and partial before that', async () => {
      const { rideId, passenger, driver } = await driveRideToCompleted();

      const beforeAnyRating = await request(app)
        .get(`/rides/${rideId}/ratings`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);
      expect(beforeAnyRating.status).toBe(200);
      expect(beforeAnyRating.body.data).toEqual({ passengerToDriver: null, driverToPassenger: null });

      await request(app)
        .post(`/rides/${rideId}/rating`)
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send({ stars: 5 });

      const afterPassengerRated = await request(app)
        .get(`/drivers/me/rides/${rideId}/ratings`)
        .set('Authorization', `Bearer ${driver.accessToken}`);
      expect(afterPassengerRated.body.data.passengerToDriver).toMatchObject({ stars: 5 });
      expect(afterPassengerRated.body.data.driverToPassenger).toBeNull();

      await request(app)
        .post(`/drivers/me/rides/${rideId}/rating`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ stars: 4 });

      const afterBothRated = await request(app)
        .get(`/rides/${rideId}/ratings`)
        .set('Authorization', `Bearer ${passenger.accessToken}`);
      expect(afterBothRated.body.data.passengerToDriver).toMatchObject({ stars: 5 });
      expect(afterBothRated.body.data.driverToPassenger).toMatchObject({ stars: 4 });
    });
  });
});
