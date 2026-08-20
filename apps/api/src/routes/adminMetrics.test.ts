import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { metricsRecorder } from '../lib/metrics';

/** Phase 22 — GET /admin/metrics, the read surface for the in-memory
 * performance metrics recorder every request already feeds via
 * middleware/metrics.ts. */

const app = createApp();

let adminToken: string;
let passengerToken: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
): Promise<string> {
  const email = `${role.toLowerCase()}-adminmetrics-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(response.body)}`);
  return response.body.data.tokens.accessToken as string;
}

beforeAll(async () => {
  adminToken = await createUserAndLogin('ADMIN');
  passengerToken = await createUserAndLogin('PASSENGER');
});

afterAll(async () => {
  await pool.end();
});

describe('GET /admin/metrics', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/admin/metrics');
    expect(response.status).toBe(401);
  });

  it('is forbidden for a non-admin role', async () => {
    const response = await request(app)
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(403);
  });

  it('returns an array of route summaries for an admin, reflecting real traffic', async () => {
    // GET /health is real traffic that already happened via other test
    // files sharing this same process's metricsRecorder — but to make
    // this test self-contained (and independent of run order), generate
    // a known request here and assert its own route+method shows up.
    await request(app).get('/health');

    const response = await request(app)
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.routes)).toBe(true);

    const health = response.body.data.routes.find(
      (r: { method: string; route: string }) => r.method === 'GET' && r.route === '/health',
    );
    expect(health).toBeDefined();
    expect(health.count).toBeGreaterThan(0);
    expect(typeof health.avgDurationMs).toBe('number');
    expect(typeof health.p95DurationMs).toBe('number');
  });

  it('aggregates same-route requests into one summary entry, not one per request', async () => {
    metricsRecorder.reset();
    await request(app).get('/health');
    await request(app).get('/health');
    await request(app).get('/health');

    const response = await request(app)
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`);

    const healthEntries = response.body.data.routes.filter(
      (r: { method: string; route: string }) => r.method === 'GET' && r.route === '/health',
    );
    expect(healthEntries).toHaveLength(1);
    // The three /health calls above, plus this test's own preceding
    // GET /admin/metrics calls in earlier `it`s all recorded against a
    // *different* route/method key ('/admin/metrics'), so this count is
    // driven only by the three explicit /health calls just made.
    expect(healthEntries[0].count).toBeGreaterThanOrEqual(3);
  });
});
