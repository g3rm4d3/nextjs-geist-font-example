import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { pool } from '../db/pool';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example-test.test`;
}

async function registerPassenger(overrides: Partial<Record<string, unknown>> = {}) {
  return request(app)
    .post('/auth/passengers/register')
    .send({
      email: uniqueEmail('passenger'),
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Passenger',
      ...overrides,
    });
}

async function registerDriver(overrides: Partial<Record<string, unknown>> = {}) {
  return request(app)
    .post('/auth/drivers/register')
    .send({
      email: uniqueEmail('driver'),
      password: 'abcd1234',
      firstName: 'Test',
      lastName: 'Driver',
      licenseNumber: `DL-${randomUUID()}`,
      licenseState: 'CA',
      ...overrides,
    });
}

describe('POST /auth/passengers/register', () => {
  it('creates a passenger account and returns tokens', async () => {
    const response = await registerPassenger();

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('PASSENGER');
    expect(response.body.data.user.driverOnboardingStatus).toBeUndefined();
    expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(response.body.data.tokens.refreshToken).toEqual(expect.any(String));
  });

  it('lowercases the stored email', async () => {
    const email = `Mixed.Case-${randomUUID()}@Example-Test.Test`;
    const response = await registerPassenger({ email });
    expect(response.body.data.user.email).toBe(email.toLowerCase());
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail('dupe');
    await registerPassenger({ email });
    const second = await registerPassenger({ email });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with 400 and field details', async () => {
    const response = await registerPassenger({ password: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.password).toBeDefined();
  });

  it('rejects a missing firstName with 400', async () => {
    const response = await registerPassenger({ firstName: undefined });
    expect(response.status).toBe(400);
  });
});

describe('POST /auth/drivers/register', () => {
  it('creates a driver account with onboardingStatus DRAFT', async () => {
    const response = await registerDriver();

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe('DRIVER');
    expect(response.body.data.user.driverOnboardingStatus).toBe('DRAFT');
  });

  it('rejects a duplicate license number with 409', async () => {
    const licenseNumber = `DL-${randomUUID()}`;
    await registerDriver({ licenseNumber });
    const second = await registerDriver({ licenseNumber });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects a payload missing licenseNumber with 400', async () => {
    const response = await registerDriver({ licenseNumber: undefined });
    expect(response.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials', async () => {
    const email = uniqueEmail('login-ok');
    await registerPassenger({ email, password: 'abcd1234' });

    const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(email);
  });

  it('rejects the wrong password with a generic 401', async () => {
    const email = uniqueEmail('login-wrong-pw');
    await registerPassenger({ email, password: 'abcd1234' });

    const response = await request(app).post('/auth/login').send({ email, password: 'wrongpass1' });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid email or password');
  });

  it('rejects an unknown email with the same generic 401 message', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: uniqueEmail('never-registered'), password: 'whatever1' });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid email or password');
  });
});

describe('POST /auth/refresh', () => {
  it('issues a new token pair and revokes the old refresh token', async () => {
    const registerResponse = await registerPassenger();
    const oldRefreshToken = registerResponse.body.data.tokens.refreshToken;

    const refreshResponse = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldRefreshToken });

    expect(refreshResponse.status).toBe(200);
    const newRefreshToken = refreshResponse.body.data.tokens.refreshToken;
    expect(newRefreshToken).not.toBe(oldRefreshToken);

    // Reusing the now-rotated-out old token must fail...
    const reuseResponse = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(reuseResponse.status).toBe(401);

    // ...and reuse detection revokes the *entire* session family, so even
    // the token that legitimately replaced it stops working too.
    const newTokenAfterReuse = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: newRefreshToken });
    expect(newTokenAfterReuse.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });
    expect(response.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token so it can no longer be used', async () => {
    const registerResponse = await registerPassenger();
    const refreshToken = registerResponse.body.data.tokens.refreshToken;

    const logoutResponse = await request(app).post('/auth/logout').send({ refreshToken });
    expect(logoutResponse.status).toBe(200);

    const refreshAfterLogout = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('succeeds even for an unknown refresh token (no information leak)', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: 'unknown-token' });
    expect(response.status).toBe(200);
  });
});

describe('password reset flow', () => {
  it('lets a user reset their password end-to-end', async () => {
    const email = uniqueEmail('reset-flow');
    await registerPassenger({ email, password: 'oldpass12' });

    const requestResponse = await request(app).post('/auth/password-reset/request').send({ email });
    expect(requestResponse.status).toBe(200);
    const devResetToken = requestResponse.body.data.devResetToken;
    expect(devResetToken).toEqual(expect.any(String));

    const confirmResponse = await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token: devResetToken, newPassword: 'newpass34' });
    expect(confirmResponse.status).toBe(200);

    const oldPasswordLogin = await request(app)
      .post('/auth/login')
      .send({ email, password: 'oldpass12' });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/auth/login')
      .send({ email, password: 'newpass34' });
    expect(newPasswordLogin.status).toBe(200);
  });

  it('invalidates existing sessions when the password is reset', async () => {
    const email = uniqueEmail('reset-revokes-sessions');
    const registerResponse = await registerPassenger({ email, password: 'oldpass12' });
    const refreshToken = registerResponse.body.data.tokens.refreshToken;

    const requestResponse = await request(app).post('/auth/password-reset/request').send({ email });
    const devResetToken = requestResponse.body.data.devResetToken;

    await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token: devResetToken, newPassword: 'newpass34' });

    const refreshAfterReset = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(refreshAfterReset.status).toBe(401);
  });

  it('does not reveal whether an email is registered', async () => {
    const response = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: uniqueEmail('never-registered-reset') });

    // Same 200 + shape as a real account, just without a token.
    expect(response.status).toBe(200);
    expect(response.body.data.devResetToken).toBeUndefined();
  });

  it('rejects an invalid or already-used reset token', async () => {
    const response = await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token: 'not-a-real-token', newPassword: 'newpass34' });
    expect(response.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the authenticated user', async () => {
    const registerResponse = await registerPassenger();
    const accessToken = registerResponse.body.data.tokens.accessToken;

    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(registerResponse.body.data.user.email);
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await request(app).get('/auth/me');
    expect(response.status).toBe(401);
  });
});
