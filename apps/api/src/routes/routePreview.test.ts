import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { pool } from '../db/pool';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function getAccessToken(): Promise<string> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `route-preview-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Passenger',
    });
  return response.body.data.tokens.accessToken as string;
}

describe('POST /routes/preview', () => {
  it('returns a distance and duration for a valid origin/destination', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/routes/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        origin: { latitude: 40.7128, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.distanceMeters).toEqual(expect.any(Number));
    expect(response.body.data.durationSeconds).toEqual(expect.any(Number));
    expect(response.body.data.distanceMeters).toBeGreaterThan(0);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/routes/preview')
      .send({
        origin: { latitude: 40.7128, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(401);
  });

  it('rejects an out-of-range coordinate with 400', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/routes/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        origin: { latitude: 999, longitude: -74.006 },
        destination: { latitude: 40.73, longitude: -73.9925 },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing destination with 400', async () => {
    const accessToken = await getAccessToken();

    const response = await request(app)
      .post('/routes/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ origin: { latitude: 40.7128, longitude: -74.006 } });

    expect(response.status).toBe(400);
  });
});
