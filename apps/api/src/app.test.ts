import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { pool } from './db/pool';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('returns 200 with a status envelope and a request ID', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(response.body.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('reports database connectivity without failing the endpoint', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(typeof response.body.data.database.connected).toBe('boolean');
  });
});

describe('GET /ready', () => {
  it('returns 200 with status "ready" when the database is reachable', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ready');
    expect(response.body.data.database.connected).toBe(true);
    expect(response.body.requestId).toBeTruthy();
  });

  it('does not include an uptimeSeconds field (that is /health\'s concern, not readiness)', async () => {
    const response = await request(app).get('/ready');
    expect(response.body.data.uptimeSeconds).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 error envelope', async () => {
    const response = await request(app).get('/this-route-does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBeTruthy();
  });
});
