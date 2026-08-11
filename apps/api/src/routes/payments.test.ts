import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import {
  createPaymentRecord,
  findPaymentRecordById,
  setProviderPaymentIntentId,
} from '../repositories/paymentsRepository';
import * as paymentService from '../services/paymentService';

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
    .values({ name: `payments-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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

// Same reasoning as rideLifecycle.test.ts: a unique pickup per test so
// drivers made ONLINE + located in one test can never be candidates in a
// later test that happens to request a ride nearby.
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
      email: `passenger-payments-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Payments',
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
      email: `driver-payments-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Payments',
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
 * COMPLETED — the point at which Phase 11's auto-charge fires (see
 * rideLifecycleService.completeRide -> paymentService.chargeRideFare). */
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

describe('Payment sandbox (Phase 11)', () => {
  it('auto-charges the passenger on ride completion using the default test payment method', async () => {
    const { rideId, finalFareCents, passenger } = await driveRideToCompleted();

    const response = await request(app)
      .get(`/rides/${rideId}/payment`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUCCEEDED');
    expect(response.body.data.amountCents).toBe(finalFareCents);
    expect(response.body.data.rideId).toBe(rideId);
    expect(response.body.data.failureReason).toBeNull();

    // Provider-safe only: no raw card data anywhere in the response.
    const serialized = JSON.stringify(response.body.data);
    expect(serialized).not.toMatch(/\d{12,19}/); // no card-number-shaped digit run
    expect(serialized).not.toContain('cvc');
  });

  it('records a FAILED payment when the passenger has selected a declining test payment method', async () => {
    const pickup = uniquePickup();
    const passenger = await registerPassenger();
    const driver = await registerEligibleDriver(pickup);

    const patchResponse = await request(app)
      .patch('/passengers/me/payment-method')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ testPaymentMethodId: 'pm_card_chargeDeclinedInsufficientFunds' });
    expect(patchResponse.status).toBe(200);

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

    const auth = { Authorization: `Bearer ${driver.accessToken}` };
    await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
    await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);

    const paymentResponse = await request(app)
      .get(`/rides/${rideId}/payment`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(paymentResponse.status).toBe(200);
    expect(paymentResponse.body.data.status).toBe('FAILED');
    expect(paymentResponse.body.data.failureReason).toContain('insufficient funds');

    // Retry rejected while nothing has changed yet? No — a FAILED
    // attempt IS retryable. Rejected case is covered in a dedicated test
    // below; here, confirm the retry succeeds once a working payment
    // method is on file.
    await request(app)
      .patch('/passengers/me/payment-method')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ testPaymentMethodId: 'pm_card_visa' });

    const retryResponse = await request(app)
      .post(`/rides/${rideId}/payment/retry`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body.data.status).toBe('SUCCEEDED');
    expect(retryResponse.body.data.rideId).toBe(rideId);

    // Two distinct attempts now exist for this ride (the FAILED original
    // and the SUCCEEDED retry) — payment_records allows multiple rows
    // per ride, each with its own idempotency key.
    const attempts = await db
      .select()
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.rideId, rideId));
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(2);
  });

  it('rejects a retry when the most recent attempt already succeeded', async () => {
    const { rideId, passenger } = await driveRideToCompleted();

    const response = await request(app)
      .post(`/rides/${rideId}/payment/retry`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it("a passenger cannot read or retry another passenger's ride payment", async () => {
    const { rideId } = await driveRideToCompleted();
    const otherPassenger = await registerPassenger();

    const getResponse = await request(app)
      .get(`/rides/${rideId}/payment`)
      .set('Authorization', `Bearer ${otherPassenger.accessToken}`);
    expect(getResponse.status).toBe(404);

    const retryResponse = await request(app)
      .post(`/rides/${rideId}/payment/retry`)
      .set('Authorization', `Bearer ${otherPassenger.accessToken}`);
    expect(retryResponse.status).toBe(404);
  });

  it('rejects an unrecognized test payment method id', async () => {
    const passenger = await registerPassenger();

    const response = await request(app)
      .patch('/passengers/me/payment-method')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ testPaymentMethodId: 'pm_card_not_a_real_test_method' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('POST /webhooks/stripe', () => {
    const webhookSecret = 'whsec_test_only_secret_do_not_use_elsewhere'; // matches vitest.config.mts

    function signedPayload(providerPaymentIntentId: string, type: string, failureMessage?: string) {
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type,
        data: {
          object: {
            id: providerPaymentIntentId,
            object: 'payment_intent',
            ...(failureMessage
              ? { last_payment_error: { message: failureMessage } }
              : {}),
          },
        },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      return { payload, header };
    }

    it('rejects a delivery with an invalid signature', async () => {
      const { payload } = signedPayload('pi_mock_does_not_matter', 'payment_intent.succeeded');

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=not-a-real-signature')
        .send(payload);

      expect(response.status).toBe(403);
    });

    it('accepts (as a no-op) a validly-signed event for an unknown payment intent', async () => {
      const { payload, header } = signedPayload(`pi_mock_${randomUUID()}`, 'payment_intent.succeeded');

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.data.received).toBe(true);
    });

    it('resolves a genuinely PENDING payment record to SUCCEEDED via a real signature-verified delivery', async () => {
      const { rideId } = await driveRideToCompleted();
      const providerPaymentIntentId = `pi_mock_${randomUUID()}`;

      // Simulates a second, independent in-flight PaymentIntent for this
      // ride (e.g. a client-initiated retry whose confirm call hasn't
      // resolved yet) sitting genuinely PENDING — unlike the synchronous
      // MOCK confirm flow this repository call never confirms it, so the
      // webhook below is the only thing that can resolve it.
      const record = await createPaymentRecord({
        rideId,
        amountCents: 1234,
        currency: 'usd',
        idempotencyKey: `webhook-test-${randomUUID()}`,
      });
      await setProviderPaymentIntentId(record.id, providerPaymentIntentId);

      const { payload, header } = signedPayload(providerPaymentIntentId, 'payment_intent.succeeded');

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(response.status).toBe(200);

      const updated = await findPaymentRecordById(record.id);
      expect(updated?.status).toBe('SUCCEEDED');
    });

    it('resolves a genuinely PENDING payment record to FAILED with a failure reason', async () => {
      const { rideId } = await driveRideToCompleted();
      const providerPaymentIntentId = `pi_mock_${randomUUID()}`;

      const record = await createPaymentRecord({
        rideId,
        amountCents: 1234,
        currency: 'usd',
        idempotencyKey: `webhook-test-${randomUUID()}`,
      });
      await setProviderPaymentIntentId(record.id, providerPaymentIntentId);

      const { payload, header } = signedPayload(
        providerPaymentIntentId,
        'payment_intent.payment_failed',
        'Your card was declined.',
      );

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(response.status).toBe(200);

      const updated = await findPaymentRecordById(record.id);
      expect(updated?.status).toBe('FAILED');
      expect(updated?.failureReason).toBe('Your card was declined.');
    });

    it('is idempotent — redelivering an event for an already-resolved payment intent is a no-op', async () => {
      const { rideId } = await driveRideToCompleted();
      const [existing] = await db
        .select()
        .from(schema.paymentRecords)
        .where(eq(schema.paymentRecords.rideId, rideId));
      if (!existing?.providerPaymentIntentId) {
        throw new Error('Expected the auto-charge to have set a provider payment intent id');
      }
      expect(existing.status).toBe('SUCCEEDED');

      // Redeliver a "failed" event for the same (already SUCCEEDED)
      // intent — the compare-and-swap only transitions a PENDING record,
      // so this must not flip a resolved SUCCEEDED payment to FAILED.
      const { payload, header } = signedPayload(
        existing.providerPaymentIntentId,
        'payment_intent.payment_failed',
        'Should never apply — already resolved.',
      );

      const response = await request(app)
        .post('/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(payload);
      expect(response.status).toBe(200);

      const stillSucceeded = await findPaymentRecordById(existing.id);
      expect(stillSucceeded?.status).toBe('SUCCEEDED');
    });
  });

  describe('paymentService.refundPayment (refund architecture)', () => {
    it('refunds a SUCCEEDED payment and records a provider-safe refund reference', async () => {
      const { rideId } = await driveRideToCompleted();
      const [record] = await db
        .select()
        .from(schema.paymentRecords)
        .where(eq(schema.paymentRecords.rideId, rideId));
      if (!record) throw new Error('Expected a payment record to exist');

      const refunded = await paymentService.refundPayment(record.id, 'Passenger requested a refund');

      expect(refunded.status).toBe('REFUNDED');
      expect(refunded.refundedAt).not.toBeNull();
      expect(refunded.refundReason).toBe('Passenger requested a refund');
    });

    it('rejects refunding a payment that is not SUCCEEDED', async () => {
      const pickup = uniquePickup();
      const passenger = await registerPassenger();
      await registerEligibleDriver(pickup);

      // A ride that was never completed has no payment at all — insert a
      // PENDING record directly to exercise the guard without needing a
      // full failed-charge flow.
      const rideResponse = await request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${passenger.accessToken}`)
        .send(rideRequestBody(pickup));
      const rideId = rideResponse.body.data.id as string;

      const record = await createPaymentRecord({
        rideId,
        amountCents: 500,
        currency: 'usd',
        idempotencyKey: `refund-guard-${randomUUID()}`,
      });

      await expect(paymentService.refundPayment(record.id)).rejects.toThrow(/successfully charged/);
    });
  });
});
