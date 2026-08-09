import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { eq, inArray } from 'drizzle-orm';
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

const PICKUP = { coordinate: { latitude: 40.7128, longitude: -74.006 }, label: 'Home' };
const DESTINATION = { coordinate: { latitude: 40.73, longitude: -73.9925 }, label: 'Work' };

let insertedConfigId: string;

// Same pattern as pricing.test.ts: only one pricing_configs row can be
// active at a time, so pin a known config these tests can assert
// against deterministically.
beforeAll(async () => {
  await db
    .update(schema.pricingConfigs)
    .set({ active: false })
    .where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `rides-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await pool.end();
});

interface RegisteredPassenger {
  accessToken: string;
  userId: string;
}

async function registerPassenger(): Promise<RegisteredPassenger> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-ride-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Passenger',
    });
  return {
    accessToken: response.body.data.tokens.accessToken as string,
    userId: response.body.data.user.id as string,
  };
}

function rideRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    pickup: PICKUP,
    destination: DESTINATION,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe('POST /rides', () => {
  it('creates a ride and advances it straight to SEARCHING_DRIVER', async () => {
    const { accessToken } = await registerPassenger();

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody());

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      status: 'SEARCHING_DRIVER',
      pickup: PICKUP,
      destination: DESTINATION,
    });
    expect(response.body.data.estimatedFareCents).toBeGreaterThanOrEqual(TEST_CONFIG.minimumFareCents);
    expect(response.body.data.estimatedDistanceMeters).toBeGreaterThan(0);
    expect(response.body.data.estimatedDurationSeconds).toBeGreaterThan(0);
    expect(typeof response.body.data.id).toBe('string');
  });

  it('records both REQUESTED and SEARCHING_DRIVER as ride_events', async () => {
    const { accessToken } = await registerPassenger();

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody());
    const rideId = response.body.data.id as string;

    const events = await db
      .select({ previousStatus: schema.rideEvents.previousStatus, newStatus: schema.rideEvents.newStatus, actorType: schema.rideEvents.actorType })
      .from(schema.rideEvents)
      .where(eq(schema.rideEvents.rideId, rideId))
      .orderBy(schema.rideEvents.createdAt);

    expect(events).toEqual([
      { previousStatus: null, newStatus: 'REQUESTED', actorType: 'PASSENGER' },
      { previousStatus: 'REQUESTED', newStatus: 'SEARCHING_DRIVER', actorType: 'SYSTEM' },
    ]);
  });

  it('never uses a client-supplied fare figure', async () => {
    const { accessToken } = await registerPassenger();

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody({ estimatedFareCents: 1, totalCents: 1 }));

    expect(response.status).toBe(201);
    // The bogus client value is stripped by the schema and never reaches
    // the service — the real fare is always >= the minimum fare.
    expect(response.body.data.estimatedFareCents).toBeGreaterThanOrEqual(TEST_CONFIG.minimumFareCents);
    expect(response.body.data.estimatedFareCents).not.toBe(1);
  });

  it('replays the same ride for a repeated idempotency key instead of creating a second one', async () => {
    const { accessToken } = await registerPassenger();
    const idempotencyKey = randomUUID();

    const first = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody({ idempotencyKey }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody({ idempotencyKey }));

    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('rejects a second ride request while one is already active', async () => {
    const { accessToken } = await registerPassenger();

    const first = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody());
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody()); // a different idempotency key — a genuinely new attempt

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('handles a concurrent double-tap with the same idempotency key as one ride', async () => {
    const { accessToken } = await registerPassenger();
    const idempotencyKey = randomUUID();
    const body = rideRequestBody({ idempotencyKey });

    const [first, second] = await Promise.all([
      request(app).post('/rides').set('Authorization', `Bearer ${accessToken}`).send(body),
      request(app).post('/rides').set('Authorization', `Bearer ${accessToken}`).send(body),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);

    const rows = await db
      .select({ id: schema.rides.id })
      .from(schema.rides)
      .where(eq(schema.rides.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it('handles a concurrent double-tap with different idempotency keys as exactly one active ride', async () => {
    const { accessToken } = await registerPassenger();
    const keyA = randomUUID();
    const keyB = randomUUID();

    const [first, second] = await Promise.all([
      request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(rideRequestBody({ idempotencyKey: keyA })),
      request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(rideRequestBody({ idempotencyKey: keyB })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const rows = await db
      .select({ id: schema.rides.id })
      .from(schema.rides)
      .where(inArray(schema.rides.idempotencyKey, [keyA, keyB]));
    expect(rows).toHaveLength(1);
  });

  it('rejects a request from a disabled passenger account', async () => {
    const { accessToken, userId } = await registerPassenger();
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, userId));

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a missing idempotencyKey with 400', async () => {
    const { accessToken } = await registerPassenger();
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = rideRequestBody();

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(withoutKey);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range coordinate with 400', async () => {
    const { accessToken } = await registerPassenger();

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(rideRequestBody({ pickup: { coordinate: { latitude: 999, longitude: 0 }, label: 'Nowhere' } }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a driver with 403', async () => {
    const driverRegister = await request(app)
      .post('/auth/drivers/register')
      .send({
        email: `driver-ride-${randomUUID()}@example-test.test`,
        password: 'abcd1234',
        firstName: 'Test',
        lastName: 'Driver',
        licenseNumber: `DL-${randomUUID()}`,
        licenseState: 'CA',
      });
    const driverToken = driverRegister.body.data.tokens.accessToken as string;

    const response = await request(app)
      .post('/rides')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(rideRequestBody());

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post('/rides').send(rideRequestBody());
    expect(response.status).toBe(401);
  });
});
