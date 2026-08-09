import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
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

// Only one pricing_configs row can have active = true (partial unique
// index) — deactivate anything already active before inserting a known,
// deterministic config these tests can assert exact numbers against.
beforeAll(async () => {
  await db.update(schema.pricingConfigs).set({ active: false }).where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `pricing-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await pool.end();
});

async function getAccessToken(): Promise<string> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `pricing-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Passenger',
    });
  return response.body.data.tokens.accessToken as string;
}

describe('POST /pricing/estimate', () => {
  it('returns an itemized fare using the active pricing config', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        origin: { latitude: 40.7128, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(200);
    const data = response.body.data;

    expect(data.baseFareCents).toBe(TEST_CONFIG.baseFareCents);
    expect(data.bookingFeeCents).toBe(TEST_CONFIG.bookingFeeCents);
    expect(data.minimumFareCents).toBe(TEST_CONFIG.minimumFareCents);
    expect(data.subtotalCents).toBe(
      data.baseFareCents + data.distanceFareCents + data.timeFareCents + data.bookingFeeCents,
    );
    expect(data.totalCents).toBeGreaterThanOrEqual(data.minimumFareCents);
    // Ledger invariant: must always sum back exactly (matches
    // driver_earnings' balance CHECK constraint downstream).
    expect(data.platformCommissionCents + data.driverEarningsCents).toBe(data.totalCents);
  });

  it('applies the minimum fare for a very short trip', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        // Same point twice — zero distance, zero duration.
        origin: { latitude: 40.7128, longitude: -74.006 },
        destination: { latitude: 40.7128, longitude: -74.006 },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.minimumFareApplied).toBe(true);
    expect(response.body.data.totalCents).toBe(TEST_CONFIG.minimumFareCents);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/pricing/estimate')
      .send({
        origin: { latitude: 40.7128, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(401);
  });

  it('rejects an out-of-range coordinate with 400', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        origin: { latitude: 999, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
