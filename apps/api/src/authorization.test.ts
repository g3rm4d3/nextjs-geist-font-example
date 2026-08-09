import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { env } from './config/env';
import { db } from './db/client';
import { pool } from './db/pool';

/**
 * Cross-role attack coverage required by Phase 2's definition of done:
 * a passenger must not reach driver-only endpoints, a driver must not
 * reach admin-only endpoints, and admin privileges are validated
 * server-side from the signed JWT — never from anything the client sends.
 *
 * There is no admin registration endpoint by design (section 8: "no
 * public admin registration"), so admin test accounts are provisioned
 * directly against the database here, exactly like a real deployment
 * would provision its first admin outside the public API.
 */

const app = createApp();

let passengerToken: string;
let driverToken: string;
let adminToken: string;
let superAdminToken: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
  password = 'abcd1234',
): Promise<string> {
  const email = `${role.toLowerCase()}-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword(password);

  await db.insert(schema.users).values({ email, passwordHash, role });

  const response = await request(app).post('/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Failed to log in fixture user: ${JSON.stringify(response.body)}`);
  }
  return response.body.data.tokens.accessToken as string;
}

beforeAll(async () => {
  const passengerRegister = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Passenger',
    });
  passengerToken = passengerRegister.body.data.tokens.accessToken;

  const driverRegister = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Driver',
      licenseNumber: `DL-${randomUUID()}`,
      licenseState: 'CA',
    });
  driverToken = driverRegister.body.data.tokens.accessToken;

  adminToken = await createUserAndLogin('ADMIN');
  superAdminToken = await createUserAndLogin('SUPER_ADMIN');
});

afterAll(async () => {
  await pool.end();
});

describe('driver-only endpoint (GET /drivers/me)', () => {
  it('allows a driver', async () => {
    const response = await request(app)
      .get('/drivers/me')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(response.status).toBe(200);
  });

  it('blocks a passenger with 403', async () => {
    const response = await request(app)
      .get('/drivers/me')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks an admin with 403 (admin is not a driver)', async () => {
    const response = await request(app)
      .get('/drivers/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(403);
  });
});

describe('passenger-only endpoint (GET /passengers/me)', () => {
  it('allows a passenger', async () => {
    const response = await request(app)
      .get('/passengers/me')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(200);
  });

  it('blocks a driver with 403', async () => {
    const response = await request(app)
      .get('/passengers/me')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(response.status).toBe(403);
  });
});

describe('admin-only endpoint (GET /admin/users)', () => {
  it('allows an ADMIN', async () => {
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('allows a SUPER_ADMIN', async () => {
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(response.status).toBe(200);
  });

  it('blocks a passenger with 403', async () => {
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks a driver with 403', async () => {
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(response.status).toBe(403);
  });
});

describe('token validation', () => {
  it('rejects a request with no token at all (401)', async () => {
    const response = await request(app).get('/passengers/me');
    expect(response.status).toBe(401);
  });

  it('rejects a malformed Authorization header (401)', async () => {
    const response = await request(app).get('/passengers/me').set('Authorization', passengerToken); // missing "Bearer " prefix
    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret (401)', async () => {
    const forgedToken = jwt.sign({ role: 'ADMIN' }, 'a-completely-different-secret', {
      subject: randomUUID(),
      expiresIn: '15m',
    });
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${forgedToken}`);
    expect(response.status).toBe(401);
  });

  it('rejects an expired token (401)', async () => {
    const expiredToken = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, {
      subject: randomUUID(),
      expiresIn: -10, // already expired 10 seconds ago
    });
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(response.status).toBe(401);
  });

  it('rejects a tampered token (401)', async () => {
    const tampered = `${passengerToken.slice(0, -1)}${passengerToken.endsWith('a') ? 'b' : 'a'}`;
    const response = await request(app)
      .get('/passengers/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(response.status).toBe(401);
  });

  it('rejects a client-supplied role claim that does not match the signed token', async () => {
    // Even if a malicious client sends its own "role" field, the server
    // only ever trusts the role embedded in the *signed* JWT it issued —
    // there is nowhere in the request a client can inject a role that
    // reaches requireRole.
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({ role: 'ADMIN' });
    expect(response.status).toBe(403);
  });
});
