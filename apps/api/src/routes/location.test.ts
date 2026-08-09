import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function registerDriver(): Promise<string> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-loc-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Loc',
      lastName: 'Driver',
      licenseNumber: `DL-${randomUUID()}`,
      licenseState: 'CA',
    });
  return response.body.data.tokens.accessToken as string;
}

async function registerDriverWithProfileId(): Promise<{
  accessToken: string;
  driverProfileId: string;
}> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-loc-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Loc',
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

  return { accessToken, driverProfileId: profile.id };
}

async function createAdminToken(): Promise<string> {
  const email = `admin-loc-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role: 'ADMIN' });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  return response.body.data.tokens.accessToken as string;
}

describe('POST /drivers/me/location', () => {
  it('records a location ping and returns it, written: true', async () => {
    const accessToken = await registerDriver();

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 40.7128, longitude: -74.006, heading: 90, speed: 5, accuracy: 10 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      written: true,
      location: {
        latitude: 40.7128,
        longitude: -74.006,
        heading: 90,
        speed: 5,
        accuracy: 10,
        isStale: false,
      },
    });
    expect(response.body.data.location.recordedAt).toBeDefined();
  });

  it('accepts a minimal ping (coordinates only)', async () => {
    const accessToken = await registerDriver();

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 40.7128, longitude: -74.006 });

    expect(response.status).toBe(200);
    expect(response.body.data.location).toMatchObject({
      heading: null,
      speed: null,
      accuracy: null,
    });
  });

  it('skips the write when pings arrive faster than the minimum interval', async () => {
    const accessToken = await registerDriver();

    const first = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 40.7128, longitude: -74.006 });
    expect(first.body.data.written).toBe(true);

    const second = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 41.0, longitude: -75.0 });

    expect(second.status).toBe(200);
    expect(second.body.data.written).toBe(false);
    // Still reflects the first (persisted) ping, not the just-received one.
    expect(second.body.data.location.latitude).toBe(40.7128);
    expect(second.body.data.location.longitude).toBe(-74.006);
  });

  it('flags an old timestamp as stale without rejecting it', async () => {
    const accessToken = await registerDriver();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 40.7128, longitude: -74.006, timestamp: tenMinutesAgo });

    expect(response.status).toBe(200);
    expect(response.body.data.written).toBe(true);
    expect(response.body.data.location.isStale).toBe(true);
    expect(response.body.data.location.recordedAt).toBe(tenMinutesAgo);
  });

  it('rejects a timestamp too far in the future', async () => {
    const accessToken = await registerDriver();
    const inTenMinutes = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 40.7128, longitude: -74.006, timestamp: inTenMinutes });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range coordinate with 400', async () => {
    const accessToken = await registerDriver();

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ latitude: 999, longitude: -74.006 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a passenger with 403', async () => {
    const passengerRegister = await request(app)
      .post('/auth/passengers/register')
      .send({
        email: `passenger-loc-${randomUUID()}@example-test.test`,
        password: 'abcd1234',
        firstName: 'Test',
        lastName: 'Passenger',
      });
    const passengerToken = passengerRegister.body.data.tokens.accessToken as string;

    const response = await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({ latitude: 40.7128, longitude: -74.006 });

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/drivers/me/location')
      .send({ latitude: 40.7128, longitude: -74.006 });
    expect(response.status).toBe(401);
  });
});

describe('GET /admin/drivers/locations', () => {
  it('includes a driver who has posted a location', async () => {
    const { accessToken: driverToken, driverProfileId } = await registerDriverWithProfileId();
    await request(app)
      .post('/drivers/me/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ latitude: 40.7511, longitude: -73.9822 });

    const adminToken = await createAdminToken();
    const response = await request(app)
      .get('/admin/drivers/locations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);

    // Matched by driverId, not by coordinate: GET /admin/drivers/locations
    // returns every driver's row unscoped, and this fixture's lat/lng
    // literal is shared across every run of this test against a
    // persistent database — a driver-specific match is the only
    // unambiguous one.
    const entry = response.body.data.find(
      (row: { driverId: string }) => row.driverId === driverProfileId,
    );
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      firstName: 'Loc',
      lastName: 'Driver',
      availabilityStatus: 'OFFLINE',
      isStale: false,
      latitude: 40.7511,
      longitude: -73.9822,
    });
  });

  it('rejects a driver with 403', async () => {
    const driverToken = await registerDriver();
    const response = await request(app)
      .get('/admin/drivers/locations')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/admin/drivers/locations');
    expect(response.status).toBe(401);
  });
});
