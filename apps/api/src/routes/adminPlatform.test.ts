import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

/**
 * Phase 14 — the platform-configuration and oversight sections that
 * don't hang off an existing domain object: Support, Pricing, System
 * Settings, Dashboard, Earnings (per-driver breakdown), and Audit Logs.
 */

const app = createApp();

let adminToken: string;
let superAdminToken: string;
let passengerToken: string;
let adminUserId: string;
let superAdminUserId: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
): Promise<{ token: string; userId: string }> {
  const email = `${role.toLowerCase()}-adminplatform-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  const [user] = await db.insert(schema.users).values({ email, passwordHash, role }).returning();
  if (!user) throw new Error('Failed to insert fixture user');
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(response.body)}`);
  return { token: response.body.data.tokens.accessToken as string, userId: user.id };
}

async function latestAuditLogFor(entityId: string): Promise<typeof schema.auditLogs.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(schema.auditLogs.createdAt);
  return row;
}

beforeAll(async () => {
  const admin = await createUserAndLogin('ADMIN');
  adminToken = admin.token;
  adminUserId = admin.userId;
  const superAdmin = await createUserAndLogin('SUPER_ADMIN');
  superAdminToken = superAdmin.token;
  superAdminUserId = superAdmin.userId;

  const passengerRegister = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-adminplatform-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Platform',
      lastName: 'Test',
    });
  passengerToken = passengerRegister.body.data.tokens.accessToken;
});

afterAll(async () => {
  await pool.end();
});

describe('Admin support tickets (Phase 14)', () => {
  it('lists a ticket and inspects its message thread, oldest-first, including internal notes', async () => {
    const [ticket] = await db
      .insert(schema.supportTickets)
      .values({ userId: adminUserId, subject: `Test issue ${randomUUID()}`, status: 'OPEN' })
      .returning();
    if (!ticket) throw new Error('Failed to seed support ticket');

    // Explicit, distinctly-ordered createdAt values — two rows inserted
    // in the same statement can otherwise land on the same defaultNow()
    // tick, making asc(createdAt) order ambiguous.
    const now = Date.now();
    await db.insert(schema.supportMessages).values([
      {
        ticketId: ticket.id,
        authorUserId: adminUserId,
        body: 'First message',
        isInternalNote: false,
        createdAt: new Date(now),
      },
      {
        ticketId: ticket.id,
        authorUserId: adminUserId,
        body: 'Internal note',
        isInternalNote: true,
        createdAt: new Date(now + 1000),
      },
    ]);

    const listResponse = await request(app)
      .get('/admin/support/tickets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { id: string }) => row.id === ticket.id)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/support/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.messages).toHaveLength(2);
    expect(detailResponse.body.data.messages[0].body).toBe('First message');
    expect(detailResponse.body.data.messages[1].isInternalNote).toBe(true);

    const notFound = await request(app)
      .get(`/admin/support/tickets/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(notFound.status).toBe(404);

    const blocked = await request(app)
      .get('/admin/support/tickets')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(blocked.status).toBe(403);
  });
});

describe('Admin pricing (Phase 14)', () => {
  it('blocks a plain ADMIN from changing pricing (403), allows SUPER_ADMIN, versions history, and audits', async () => {
    const blocked = await request(app)
      .post('/admin/pricing/configs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `should-be-blocked-${randomUUID()}`,
        baseFareCents: 300,
        perMileRateCents: 150,
        perMinuteRateCents: 25,
        minimumFareCents: 500,
        bookingFeeCents: 200,
        cancellationFeeCents: 500,
        platformCommissionPercentage: 20,
      });
    expect(blocked.status).toBe(403);

    const configName = `test-config-${randomUUID()}`;
    const response = await request(app)
      .post('/admin/pricing/configs')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: configName,
        baseFareCents: 300,
        perMileRateCents: 175,
        perMinuteRateCents: 30,
        minimumFareCents: 600,
        bookingFeeCents: 250,
        cancellationFeeCents: 550,
        platformCommissionPercentage: 22.5,
      });
    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe(configName);
    expect(response.body.data.active).toBe(true);
    expect(response.body.data.platformCommissionPercentage).toBe(22.5);

    const listResponse = await request(app)
      .get('/admin/pricing/configs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    const active = listResponse.body.data.filter((row: { active: boolean }) => row.active);
    // Exactly one active config after the swap (pricing_configs_one_active_key).
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe(configName);

    const audit = await latestAuditLogFor(response.body.data.id);
    expect(audit?.action).toBe('pricing.change');
    expect(audit?.actorRole).toBe('SUPER_ADMIN');

    // Duplicate name -> 409.
    const duplicate = await request(app)
      .post('/admin/pricing/configs')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: configName,
        baseFareCents: 300,
        perMileRateCents: 175,
        perMinuteRateCents: 30,
        minimumFareCents: 600,
        bookingFeeCents: 250,
        cancellationFeeCents: 550,
        platformCommissionPercentage: 22.5,
      });
    expect(duplicate.status).toBe(409);
  });
});

describe('Admin system settings (Phase 14)', () => {
  it('blocks a plain ADMIN from writing settings (403), allows SUPER_ADMIN, and audits', async () => {
    const key = `test.setting.${randomUUID()}`;

    const blocked = await request(app)
      .put(`/admin/settings/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'nope' });
    expect(blocked.status).toBe(403);

    const response = await request(app)
      .put(`/admin/settings/${key}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ value: { enabled: true }, description: 'Test flag' });
    expect(response.status).toBe(200);
    expect(response.body.data.key).toBe(key);
    expect(response.body.data.value).toEqual({ enabled: true });

    const listResponse = await request(app).get('/admin/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { key: string }) => row.key === key)).toBe(true);

    const audit = await latestAuditLogFor(response.body.data.id);
    expect(audit?.action).toBe('settings.upsert');

    // Re-upsert same key updates in place rather than creating a second row.
    const secondWrite = await request(app)
      .put(`/admin/settings/${key}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ value: { enabled: false } });
    expect(secondWrite.status).toBe(200);
    expect(secondWrite.body.data.id).toBe(response.body.data.id);
    expect(secondWrite.body.data.value).toEqual({ enabled: false });
  });
});

describe('Admin dashboard + earnings (Phase 14)', () => {
  it('returns a dashboard summary shape any admin can read', async () => {
    const response = await request(app).get('/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalPassengers: expect.any(Number),
      totalDrivers: expect.any(Number),
      pendingDriverApplications: expect.any(Number),
      pendingDocuments: expect.any(Number),
      activeRideCount: expect.any(Number),
      openSupportTicketCount: expect.any(Number),
      todayRideCount: expect.any(Number),
      todayPlatformCommissionCents: expect.any(Number),
    });
  });

  it('returns a per-driver earnings breakdown', async () => {
    const response = await request(app)
      .get('/admin/earnings/by-driver')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    if (response.body.data.length > 0) {
      expect(response.body.data[0]).toMatchObject({
        driverId: expect.any(String),
        driverName: expect.any(String),
        rideCount: expect.any(Number),
        grossFareCents: expect.any(Number),
        platformCommissionCents: expect.any(Number),
        driverGrossEarningsCents: expect.any(Number),
      });
    }
  });
});

describe('Admin audit logs (Phase 14)', () => {
  it('is SUPER_ADMIN only and lists prior sensitive actions', async () => {
    // superAdminUserId already generated at least one audit row above
    // (pricing.change / settings.upsert) by the time this suite runs.
    const blocked = await request(app).get('/admin/audit-logs').set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(403);

    const response = await request(app)
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.some((row: { actorUserId: string }) => row.actorUserId === superAdminUserId)).toBe(
      true,
    );
  });
});
