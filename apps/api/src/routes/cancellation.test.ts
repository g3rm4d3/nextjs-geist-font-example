import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { cancelRideBySystem } from '../services/rideLifecycleService';

/**
 * Phase 17 — Cancellation Engine. Section 16's Phase 9 already built the
 * three cancellation pathways (passenger/driver/system) and the
 * terminal-state guard; this phase extends that with a configurable
 * cancellation fee and a configurable "driver cancellation returns the
 * ride to matching" policy — see docs/cancellation.md.
 */

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
    .values({ name: `cancellation-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;

  // Clean slate for the driver-rematch setting — a prior test file
  // sharing this database might have left a value behind.
  await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEY));
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEY));
  await pool.end();
});

const SETTING_KEY = 'cancellation.driver_return_to_matching';

interface Point {
  latitude: number;
  longitude: number;
}

// Same reasoning as every other Phase 7+ test file: a unique pickup per
// test so drivers made ONLINE + located in one test can never be
// candidates in a later test that happens to request a ride nearby.
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
      email: `passenger-cancel-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Cancel',
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
      email: `driver-cancel-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Cancel',
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

async function makeEligible(driverProfileId: string, pickup: Point, offsetLat = 0.005): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
    .where(eq(schema.driverProfiles.id, driverProfileId));

  await db.insert(schema.driverLocations).values({
    driverId: driverProfileId,
    latitude: pickup.latitude + offsetLat,
    longitude: pickup.longitude,
    recordedAt: new Date(),
  });
}

async function registerEligibleDriver(pickup: Point, offsetLat = 0.005): Promise<RegisteredDriver> {
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup, offsetLat);
  return driver;
}

function rideRequestBody(pickup: Point) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
  };
}

async function adminToken(): Promise<string> {
  const email = `admin-cancel-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role: 'ADMIN' });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  return response.body.data.tokens.accessToken as string;
}

/** Registers a passenger + one eligible driver, requests a ride (which
 * auto-matches to that driver), and accepts the resulting offer —
 * leaving the ride at DRIVER_ASSIGNED. */
async function setUpAssignedRide(): Promise<{
  rideId: string;
  pickup: Point;
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

  const acceptResponse = await request(app)
    .post(`/drivers/me/offer/${offer.id}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`);
  expect(acceptResponse.status).toBe(200);

  return { rideId, pickup, passenger, driver };
}

async function latestDriverCancelEvent(rideId: string) {
  const [row] = await db
    .select()
    .from(schema.rideEvents)
    .where(and(eq(schema.rideEvents.rideId, rideId), eq(schema.rideEvents.actorType, 'DRIVER')))
    .orderBy(desc(schema.rideEvents.createdAt));
  return row;
}

describe('Cancellation fee (Phase 17)', () => {
  it('records no fee when a passenger cancels before a driver is assigned', async () => {
    const pickup = uniquePickup();
    const passenger = await registerPassenger();

    const rideResponse = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send(rideRequestBody(pickup));
    const rideId = rideResponse.body.data.id as string;

    const response = await request(app)
      .post(`/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELLED_BY_PASSENGER');
    expect(response.body.data.cancellationFeeCents).toBe(0);
  });

  it('records the configured fee when a passenger cancels after a driver is dispatched', async () => {
    const { rideId, passenger } = await setUpAssignedRide();

    const response = await request(app)
      .post(`/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ reason: 'Found another ride' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CANCELLED_BY_PASSENGER');
    expect(response.body.data.cancellationFeeCents).toBe(TEST_CONFIG.cancellationFeeCents);

    // Never actually charged — see rideLifecycleService's own comment on
    // "potential" fee. No payment_records row exists for this ride.
    const paymentRows = await db
      .select()
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.rideId, rideId));
    expect(paymentRows).toHaveLength(0);
  });

  it('records no fee for a terminal system cancellation, regardless of ride state', async () => {
    const { rideId } = await setUpAssignedRide();

    const ride = await cancelRideBySystem(rideId, 'Platform-initiated cancellation');

    expect(ride.status).toBe('CANCELLED_BY_SYSTEM');
    expect(ride.cancellationFeeCents).toBe(0);
  });
});

describe('Driver cancellation returns ride to matching (Phase 17, default policy)', () => {
  it('returns the ride to SEARCHING_DRIVER, releases the driver, and offers to a different eligible driver', async () => {
    const { rideId, pickup, driver: firstDriver } = await setUpAssignedRide();
    // A second eligible driver, further away but still within the
    // widest matching tier, so they're the only candidate left once the
    // first driver is excluded as "already tried."
    const secondDriver = await registerEligibleDriver(pickup, 0.01);

    const cancelResponse = await request(app)
      .post(`/drivers/me/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${firstDriver.accessToken}`)
      .send({ reason: 'Car trouble' });

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data.status).toBe('SEARCHING_DRIVER');
    // Not terminally cancelled — nothing to record on the ride row itself.
    expect(cancelResponse.body.data.cancellationFeeCents).toBeNull();
    expect(cancelResponse.body.data.cancellationReason).toBeNull();

    const [firstDriverRow] = await db
      .select()
      .from(schema.driverProfiles)
      .where(eq(schema.driverProfiles.id, firstDriver.driverProfileId));
    expect(firstDriverRow?.availabilityStatus).toBe('ONLINE');

    // The first driver is never re-offered the ride they just gave up —
    // matching should have moved on to the second driver instead.
    const firstDriverOffer = await request(app)
      .get('/drivers/me/offer')
      .set('Authorization', `Bearer ${firstDriver.accessToken}`);
    expect(firstDriverOffer.body.data).toBeNull();

    const secondDriverOffer = await request(app)
      .get('/drivers/me/offer')
      .set('Authorization', `Bearer ${secondDriver.accessToken}`);
    expect(secondDriverOffer.body.data?.ride.id).toBe(rideId);
  });

  it("records the driver's cancellation (actor, reason, ride state, timestamp, zero fee) in ride_events even though the ride itself isn't terminated", async () => {
    const { rideId, driver } = await setUpAssignedRide();

    await request(app)
      .post(`/drivers/me/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ reason: 'Car trouble' });

    const event = await latestDriverCancelEvent(rideId);
    expect(event?.previousStatus).toBe('DRIVER_ASSIGNED');
    expect(event?.newStatus).toBe('SEARCHING_DRIVER');
    expect(event?.actorType).toBe('DRIVER');
    expect(event?.metadata).toMatchObject({
      cancelledBy: 'DRIVER',
      reason: 'Car trouble',
      cancellationFeeCents: 0,
      returnedToMatching: true,
    });
  });

  it('is still cancellable a second time by the new driver once matched, and by the passenger', async () => {
    const { rideId, pickup, passenger, driver: firstDriver } = await setUpAssignedRide();
    const secondDriver = await registerEligibleDriver(pickup, 0.01);

    await request(app)
      .post(`/drivers/me/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${firstDriver.accessToken}`)
      .send({});

    const [offer] = await db
      .select()
      .from(schema.rideRequests)
      .where(
        and(
          eq(schema.rideRequests.rideId, rideId),
          eq(schema.rideRequests.driverId, secondDriver.driverProfileId),
          eq(schema.rideRequests.status, 'OFFERED'),
        ),
      );
    if (!offer) throw new Error('Expected the second driver to have received an offer');

    const acceptResponse = await request(app)
      .post(`/drivers/me/offer/${offer.id}/accept`)
      .set('Authorization', `Bearer ${secondDriver.accessToken}`);
    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.data.status).toBe('DRIVER_ASSIGNED');

    const passengerCancelResponse = await request(app)
      .post(`/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({});
    expect(passengerCancelResponse.status).toBe(200);
    expect(passengerCancelResponse.body.data.status).toBe('CANCELLED_BY_PASSENGER');
    expect(passengerCancelResponse.body.data.cancellationFeeCents).toBe(TEST_CONFIG.cancellationFeeCents);
  });
});

describe('Cancellation rules configurable (Phase 17, system_settings toggle)', () => {
  it('driver cancellation is terminal (CANCELLED_BY_DRIVER) when the return-to-matching setting is disabled', async () => {
    await db.insert(schema.systemSettings).values({ key: SETTING_KEY, value: false });
    try {
      const { rideId, driver } = await setUpAssignedRide();

      const response = await request(app)
        .post(`/drivers/me/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ reason: 'Vehicle broke down' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('CANCELLED_BY_DRIVER');
      expect(response.body.data.cancellationFeeCents).toBe(0);
      expect(response.body.data.cancellationReason).toBe('Vehicle broke down');

      const [driverRow] = await db
        .select()
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.id, driver.driverProfileId));
      expect(driverRow?.availabilityStatus).toBe('ONLINE');
    } finally {
      await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEY));
    }
  });

  it('an admin can flip the setting via the generic settings endpoint (SUPER_ADMIN only)', async () => {
    const email = `superadmin-cancel-${randomUUID()}@example-test.test`;
    const passwordHash = await hashPassword('abcd1234');
    await db.insert(schema.users).values({ email, passwordHash, role: 'SUPER_ADMIN' });
    const loginResponse = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
    const superAdminToken = loginResponse.body.data.tokens.accessToken as string;

    try {
      const putResponse = await request(app)
        .put(`/admin/settings/${SETTING_KEY}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ value: false, description: 'Test override' });
      expect(putResponse.status).toBe(200);
      expect(putResponse.body.data.value).toBe(false);

      const { rideId, driver } = await setUpAssignedRide();
      const cancelResponse = await request(app)
        .post(`/drivers/me/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({});
      expect(cancelResponse.body.data.status).toBe('CANCELLED_BY_DRIVER');
    } finally {
      await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEY));
    }
  });
});

describe('Prevent invalid terminal-state cancellation (Phase 17)', () => {
  it('rejects a driver cancelling a completed ride', async () => {
    const { rideId, driver } = await setUpAssignedRide();
    const driverAuth = { Authorization: `Bearer ${driver.accessToken}` };

    await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(driverAuth);
    await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(driverAuth);
    await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(driverAuth);
    await request(app).post(`/drivers/me/rides/${rideId}/start`).set(driverAuth);
    await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(driverAuth);

    const response = await request(app)
      .post(`/drivers/me/rides/${rideId}/cancel`)
      .set(driverAuth)
      .send({});
    expect(response.status).toBe(409);
  });

  it('rejects re-cancelling an already system-cancelled ride', async () => {
    const { rideId } = await setUpAssignedRide();
    await cancelRideBySystem(rideId, 'First cancellation');

    await expect(cancelRideBySystem(rideId, 'Second cancellation')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('Admin ride detail exposes the cancellation fee (Phase 17)', () => {
  it('shows the recorded fee on GET /admin/rides/:id', async () => {
    const { rideId, passenger } = await setUpAssignedRide();
    await request(app)
      .post(`/rides/${rideId}/cancel`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({});

    const token = await adminToken();
    const response = await request(app).get(`/admin/rides/${rideId}`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.cancellationFeeCents).toBe(TEST_CONFIG.cancellationFeeCents);
    expect(response.body.data.cancelledBy).toBe('PASSENGER');
  });
});
