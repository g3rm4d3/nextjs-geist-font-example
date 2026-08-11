import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { findDriverEarningsByRideId } from '../repositories/earningsRepository';
import * as earningsService from '../services/earningsService';

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
const COMMISSION_RATE = 0.2;

let insertedConfigId: string;

beforeAll(async () => {
  await db
    .update(schema.pricingConfigs)
    .set({ active: false })
    .where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `earnings-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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
      email: `passenger-earnings-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Earnings',
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
      email: `driver-earnings-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Earnings',
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
 * COMPLETED — the point at which Phase 12's earnings ledger row is
 * recorded (rideLifecycleService.completeRide ->
 * earningsService.recordEarningsForCompletedRide). */
async function driveRideToCompleted(): Promise<{
  rideId: string;
  finalFareCents: number;
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

  return {
    rideId,
    finalFareCents: completed.body.data.finalFareCents as number,
    passenger,
    driver,
  };
}

async function createAdminAndLogin(): Promise<string> {
  const email = `admin-earnings-${randomUUID()}@example-test.test`;
  const password = 'abcd1234';
  const passwordHash = await hashPassword(password);
  await db.insert(schema.users).values({ email, passwordHash, role: 'ADMIN' });

  const response = await request(app).post('/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Failed to log in fixture admin: ${JSON.stringify(response.body)}`);
  }
  return response.body.data.tokens.accessToken as string;
}

describe('Financial ledger (Phase 12)', () => {
  it('records a driver_earnings row on ride completion matching the fare breakdown exactly', async () => {
    const { rideId, finalFareCents, driver } = await driveRideToCompleted();

    const earnings = await findDriverEarningsByRideId(rideId);
    expect(earnings).toBeDefined();
    expect(earnings?.driverId).toBe(driver.driverProfileId);
    expect(earnings?.grossFareCents).toBe(finalFareCents);

    const expectedCommission = Math.round(finalFareCents * COMMISSION_RATE);
    expect(earnings?.platformCommissionCents).toBe(expectedCommission);
    expect(earnings?.driverGrossEarningsCents).toBe(finalFareCents - expectedCommission);

    // Placeholders (section 12: "adjustments", "payout status
    // placeholder") — real values, but nothing in Stage 1 populates
    // them beyond their defaults.
    expect(earnings?.adjustmentsCents).toBe(0);
    expect(earnings?.payoutStatus).toBe('PENDING');
  });

  it('is idempotent — recording twice for the same ride does not create a second row', async () => {
    const { rideId, finalFareCents, driver } = await driveRideToCompleted();

    await earningsService.recordEarningsForCompletedRide(rideId, driver.driverProfileId, {
      baseFareCents: 0,
      distanceFareCents: 0,
      timeFareCents: 0,
      bookingFeeCents: 0,
      subtotalCents: finalFareCents,
      minimumFareCents: 0,
      minimumFareApplied: false,
      totalCents: finalFareCents,
      platformCommissionCents: 999_999, // deliberately different — must never overwrite
      driverEarningsCents: 1,
    });

    const rows = await db
      .select()
      .from(schema.driverEarnings)
      .where(eq(schema.driverEarnings.rideId, rideId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platformCommissionCents).not.toBe(999_999);
  });

  describe('GET /drivers/me/earnings/summary', () => {
    it("reflects a just-completed ride in today/week/month and isolates a driver's own totals", async () => {
      const { finalFareCents, driver } = await driveRideToCompleted();
      const otherDriver = await registerDriver(); // never completes a ride

      const response = await request(app)
        .get('/drivers/me/earnings/summary')
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(response.status).toBe(200);
      for (const period of ['today', 'week', 'month'] as const) {
        expect(response.body.data[period].rideCount).toBeGreaterThanOrEqual(1);
        expect(response.body.data[period].grossFareCents).toBeGreaterThanOrEqual(finalFareCents);
      }

      const otherResponse = await request(app)
        .get('/drivers/me/earnings/summary')
        .set('Authorization', `Bearer ${otherDriver.accessToken}`);
      expect(otherResponse.status).toBe(200);
      expect(otherResponse.body.data.today.rideCount).toBe(0);
      expect(otherResponse.body.data.today.grossFareCents).toBe(0);
      expect(otherResponse.body.data.week.rideCount).toBe(0);
      expect(otherResponse.body.data.month.rideCount).toBe(0);
    });

    it('is driver-only — a passenger token is rejected', async () => {
      const passenger = await registerPassenger();
      const response = await request(app)
        .get('/drivers/me/earnings/summary')
        .set('Authorization', `Bearer ${passenger.accessToken}`);
      expect(response.status).toBe(403);
    });
  });

  describe('GET /drivers/me/earnings/history', () => {
    it('lists the completed ride with fare breakdown, pickup/destination, and payment status', async () => {
      const { rideId, finalFareCents, driver } = await driveRideToCompleted();

      const response = await request(app)
        .get('/drivers/me/earnings/history')
        .set('Authorization', `Bearer ${driver.accessToken}`);

      expect(response.status).toBe(200);
      const entry = (response.body.data as Array<{ rideId: string; completedAt: string }>).find(
        (row) => row.rideId === rideId,
      );
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        rideId,
        grossFareCents: finalFareCents,
        payoutStatus: 'PENDING',
        // The default test payment method (pm_card_visa) always
        // succeeds — see @rideshare/payments's testPaymentMethods.ts.
        paymentStatus: 'SUCCEEDED',
        pickupLabel: 'Test Pickup',
        destinationLabel: 'Test Destination',
      });
      expect(typeof entry?.completedAt).toBe('string');
    });

    it("does not include another driver's rides", async () => {
      const { driver: driverA } = await driveRideToCompleted();
      const { driver: driverB } = await driveRideToCompleted();

      const responseA = await request(app)
        .get('/drivers/me/earnings/history')
        .set('Authorization', `Bearer ${driverA.accessToken}`);
      const rideIdsForA = (responseA.body.data as Array<{ rideId: string }>).map((r) => r.rideId);

      const responseB = await request(app)
        .get('/drivers/me/earnings/history')
        .set('Authorization', `Bearer ${driverB.accessToken}`);
      const rideIdsForB = (responseB.body.data as Array<{ rideId: string }>).map((r) => r.rideId);

      expect(rideIdsForA.some((id) => rideIdsForB.includes(id))).toBe(false);
    });
  });

  describe('GET /admin/revenue', () => {
    it('reflects newly completed rides in every window (today/week/month/allTime) via a delta check', async () => {
      const adminToken = await createAdminAndLogin();

      const before = await request(app)
        .get('/admin/revenue')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(before.status).toBe(200);

      const first = await driveRideToCompleted();
      const second = await driveRideToCompleted();
      const combinedFareCents = first.finalFareCents + second.finalFareCents;
      const combinedCommissionCents =
        Math.round(first.finalFareCents * COMMISSION_RATE) +
        Math.round(second.finalFareCents * COMMISSION_RATE);

      const after = await request(app)
        .get('/admin/revenue')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(after.status).toBe(200);

      for (const period of ['today', 'week', 'month', 'allTime'] as const) {
        const rideCountDelta =
          after.body.data[period].rideCount - before.body.data[period].rideCount;
        const grossFareDelta =
          after.body.data[period].grossFareCents - before.body.data[period].grossFareCents;
        const commissionDelta =
          after.body.data[period].platformCommissionCents -
          before.body.data[period].platformCommissionCents;

        expect(rideCountDelta).toBeGreaterThanOrEqual(2);
        expect(grossFareDelta).toBeGreaterThanOrEqual(combinedFareCents);
        expect(commissionDelta).toBeGreaterThanOrEqual(combinedCommissionCents);
      }
    });

    it('is admin-only — driver and passenger tokens are rejected', async () => {
      const passenger = await registerPassenger();
      const driver = await registerDriver();

      const asPassenger = await request(app)
        .get('/admin/revenue')
        .set('Authorization', `Bearer ${passenger.accessToken}`);
      expect(asPassenger.status).toBe(403);

      const asDriver = await request(app)
        .get('/admin/revenue')
        .set('Authorization', `Bearer ${driver.accessToken}`);
      expect(asDriver.status).toBe(403);
    });
  });
});
