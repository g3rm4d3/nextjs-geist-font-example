import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

/**
 * Phase 14 — the "inspect" read side of Passengers, Rides, Payments, and
 * Ratings. A completed, rated, paid ride (driveRideToCompleted, mirroring
 * ratings.test.ts's fixture) is real data for every one of these
 * sections to inspect, rather than four separate empty-list checks.
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
let adminToken: string;
let passengerToken: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
): Promise<string> {
  const email = `${role.toLowerCase()}-admininspect-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(response.body)}`);
  return response.body.data.tokens.accessToken as string;
}

beforeAll(async () => {
  await db.update(schema.pricingConfigs).set({ active: false }).where(eq(schema.pricingConfigs.active, true));
  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `admininspect-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;

  adminToken = await createUserAndLogin('ADMIN');
  passengerToken = await createUserAndLogin('PASSENGER');
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
      email: `passenger-admininspect-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Inspect',
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

async function registerEligibleDriver(pickup: Point): Promise<RegisteredDriver> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-admininspect-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Inspect',
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

  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
    .where(eq(schema.driverProfiles.id, profile.id));
  await db.insert(schema.driverLocations).values({
    driverId: profile.id,
    latitude: pickup.latitude + 0.005,
    longitude: pickup.longitude,
    recordedAt: new Date(),
  });

  return { accessToken, userId, driverProfileId: profile.id };
}

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
    .send({
      pickup: { coordinate: pickup, label: 'Test Pickup' },
      destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
      idempotencyKey: randomUUID(),
    });
  expect(rideResponse.status).toBe(201);
  const rideId = rideResponse.body.data.id as string;

  const [offer] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
  if (!offer) throw new Error('Expected a driver offer to have been created');

  const auth = { Authorization: `Bearer ${driver.accessToken}` };
  await request(app).post(`/drivers/me/offer/${offer.id}/accept`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
  const completed = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);
  expect(completed.status).toBe(200);

  return { rideId, passenger, driver };
}

describe('Admin inspect: Passengers/Rides/Payments/Ratings (Phase 14)', () => {
  it('lists and inspects a passenger', async () => {
    const { passenger } = await driveRideToCompleted();
    const [profile] = await db
      .select({ id: schema.passengerProfiles.id })
      .from(schema.passengerProfiles)
      .where(eq(schema.passengerProfiles.userId, passenger.userId));
    if (!profile) throw new Error('Expected passenger profile');

    const listResponse = await request(app).get('/admin/passengers').set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { id: string }) => row.id === profile.id)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/passengers/${profile.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.totalRides).toBeGreaterThanOrEqual(1);

    const notFound = await request(app)
      .get(`/admin/passengers/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(notFound.status).toBe(404);

    const blocked = await request(app)
      .get('/admin/passengers')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(blocked.status).toBe(403);
  });

  it('lists and inspects a ride, filtered by status', async () => {
    const { rideId } = await driveRideToCompleted();

    const listResponse = await request(app)
      .get('/admin/rides?status=COMPLETED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { id: string }) => row.id === rideId)).toBe(true);
    expect(listResponse.body.data.every((row: { status: string }) => row.status === 'COMPLETED')).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/rides/${rideId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.id).toBe(rideId);
    expect(detailResponse.body.data.pickup).toBeDefined();
    expect(detailResponse.body.data.destination).toBeDefined();

    const invalidFilter = await request(app)
      .get('/admin/rides?status=NOT_REAL')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(invalidFilter.status).toBe(400);

    // /admin/rides/active (Phase 10, a literal path) must not be
    // swallowed by this phase's /admin/rides/:id.
    const activeResponse = await request(app)
      .get('/admin/rides/active')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activeResponse.status).toBe(200);
    expect(Array.isArray(activeResponse.body.data)).toBe(true);
  });

  it('lists and inspects a payment generated by ride completion', async () => {
    const { rideId } = await driveRideToCompleted();

    const [paymentRow] = await db
      .select({ id: schema.paymentRecords.id, status: schema.paymentRecords.status })
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.rideId, rideId));
    if (!paymentRow) throw new Error('Expected ride completion to have auto-charged a payment record');

    const listResponse = await request(app).get('/admin/payments').set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { id: string }) => row.id === paymentRow.id)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/payments/${paymentRow.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.rideId).toBe(rideId);
    // Provider-safe only: no raw card data field exists on this shape.
    expect(detailResponse.body.data).not.toHaveProperty('cardNumber');

    const notFound = await request(app)
      .get(`/admin/payments/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(notFound.status).toBe(404);
  });

  it('lists ratings across both directions', async () => {
    const { rideId, passenger, driver } = await driveRideToCompleted();

    await request(app)
      .post(`/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ stars: 5, comment: 'Excellent' });
    await request(app)
      .post(`/drivers/me/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ stars: 4 });

    const response = await request(app).get('/admin/ratings').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const ratingsForRide = response.body.data.filter((row: { rideId: string }) => row.rideId === rideId);
    expect(ratingsForRide).toHaveLength(2);
    expect(ratingsForRide.some((row: { direction: string }) => row.direction === 'PASSENGER_TO_DRIVER')).toBe(true);
    expect(ratingsForRide.some((row: { direction: string }) => row.direction === 'DRIVER_TO_PASSENGER')).toBe(true);
  });
});
