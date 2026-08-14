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
 * Phase 14 — driver moderation (approve/reject/suspend/reactivate) and
 * document review, plus the audit trail those mutating actions must
 * generate. Same "provision fixture admins directly against the
 * database" approach as authorization.test.ts (there is no public admin
 * registration endpoint by design).
 */

const app = createApp();

let adminToken: string;
let superAdminToken: string;
let passengerToken: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
): Promise<string> {
  const email = `${role.toLowerCase()}-admindrivers-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(response.body)}`);
  return response.body.data.tokens.accessToken as string;
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
      email: `driver-admindrivers-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Admin',
      lastName: 'Test',
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

async function setOnboardingStatus(
  driverProfileId: string,
  status: (typeof schema.driverOnboardingStatusEnum.enumValues)[number],
): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: status })
    .where(eq(schema.driverProfiles.id, driverProfileId));
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
  adminToken = await createUserAndLogin('ADMIN');
  superAdminToken = await createUserAndLogin('SUPER_ADMIN');

  const passengerRegister = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-admindrivers-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Admin',
      lastName: 'Test',
    });
  passengerToken = passengerRegister.body.data.tokens.accessToken;
});

afterAll(async () => {
  await pool.end();
});

describe('Admin driver moderation (Phase 14)', () => {
  it('approves a PENDING_REVIEW driver and writes an audit record', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'PENDING_REVIEW');

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingStatus).toBe('APPROVED');

    const audit = await latestAuditLogFor(driver.driverProfileId);
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('driver.approve');
    expect(audit?.entityType).toBe('driver_profile');
  });

  it('rejects approving a driver that is not pending review (409)', async () => {
    const driver = await registerDriver();
    // Still DRAFT — never submitted an application.
    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(409);
  });

  it('rejects a PENDING_REVIEW driver with a reason and writes an audit record', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'PENDING_REVIEW');

    const missingReason = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(missingReason.status).toBe(400);

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Failed background check' });

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingStatus).toBe('REJECTED');

    const audit = await latestAuditLogFor(driver.driverProfileId);
    expect(audit?.action).toBe('driver.reject');
  });

  it('blocks a plain ADMIN from suspending a driver (403), allows SUPER_ADMIN, and forces availability OFFLINE', async () => {
    const driver = await registerDriver();
    await db
      .update(schema.driverProfiles)
      .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
      .where(eq(schema.driverProfiles.id, driver.driverProfileId));

    const blocked = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Multiple passenger complaints' });
    expect(blocked.status).toBe(403);

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/suspend`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: 'Multiple passenger complaints' });

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingStatus).toBe('SUSPENDED');
    expect(response.body.data.availabilityStatus).toBe('OFFLINE');

    const audit = await latestAuditLogFor(driver.driverProfileId);
    expect(audit?.action).toBe('driver.suspend');
  });

  it('blocks a plain ADMIN from reactivating a driver (403), allows SUPER_ADMIN', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'SUSPENDED');

    const blocked = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(403);

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/reactivate`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.onboardingStatus).toBe('APPROVED');
  });

  it('blocks a passenger entirely from driver moderation endpoints (403)', async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/approve`)
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(403);
  });

  it('lists drivers filtered by onboardingStatus (doubling as "Driver Applications")', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'PENDING_REVIEW');

    const response = await request(app)
      .get('/admin/drivers?onboardingStatus=PENDING_REVIEW')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.some((row: { id: string }) => row.id === driver.driverProfileId)).toBe(true);
    expect(
      response.body.data.every((row: { onboardingStatus: string }) => row.onboardingStatus === 'PENDING_REVIEW'),
    ).toBe(true);

    const invalidFilter = await request(app)
      .get('/admin/drivers?onboardingStatus=NOT_A_STATUS')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(invalidFilter.status).toBe(400);
  });

  it('returns 404 for an unknown driver id', async () => {
    const response = await request(app)
      .get(`/admin/drivers/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  it('reviews a document (approve and reject) and writes audit records', async () => {
    const driver = await registerDriver();
    const [approvedDoc] = await db
      .insert(schema.driverDocuments)
      .values({
        driverId: driver.driverProfileId,
        documentType: 'DRIVER_LICENSE',
        storageKey: `test/${randomUUID()}.jpg`,
      })
      .returning();
    const [rejectedDoc] = await db
      .insert(schema.driverDocuments)
      .values({
        driverId: driver.driverProfileId,
        documentType: 'INSURANCE',
        storageKey: `test/${randomUUID()}.jpg`,
      })
      .returning();
    if (!approvedDoc || !rejectedDoc) throw new Error('Failed to seed test documents');

    const approveResponse = await request(app)
      .post(`/admin/documents/${approvedDoc.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: true });
    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.data.reviewStatus).toBe('APPROVED');

    const missingReason = await request(app)
      .post(`/admin/documents/${rejectedDoc.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: false });
    expect(missingReason.status).toBe(400);

    const rejectResponse = await request(app)
      .post(`/admin/documents/${rejectedDoc.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: false, rejectionReason: 'Illegible photo' });
    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.data.reviewStatus).toBe('REJECTED');
    expect(rejectResponse.body.data.rejectionReason).toBe('Illegible photo');

    // Already-reviewed document can't be re-reviewed.
    const alreadyReviewed = await request(app)
      .post(`/admin/documents/${approvedDoc.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: true });
    expect(alreadyReviewed.status).toBe(409);

    const audit = await latestAuditLogFor(rejectedDoc.id);
    expect(audit?.action).toBe('document.reject');
    expect(audit?.entityType).toBe('driver_document');

    const listResponse = await request(app)
      .get('/admin/documents?reviewStatus=REJECTED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row: { id: string }) => row.id === rejectedDoc.id)).toBe(true);
  });

  it('lists vehicles read-only', async () => {
    const response = await request(app).get('/admin/vehicles').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });
});
