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
 * Phase 15 — driver document upload (a driver's own POST/GET
 * /drivers/me/documents), admin "request replacement" (the third
 * document action alongside Phase 14's approve/reject), internal
 * expiration warnings, and the BackgroundCheckProvider (MOCK ONLY)
 * wired into driver moderation.
 */

const app = createApp();

let adminToken: string;
let passengerToken: string;

async function createUserAndLogin(
  role: (typeof schema.userRoleEnum.enumValues)[number],
): Promise<{ token: string; userId: string }> {
  const email = `${role.toLowerCase()}-docmgmt-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  const [user] = await db.insert(schema.users).values({ email, passwordHash, role }).returning();
  if (!user) throw new Error('Failed to insert fixture user');
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  if (response.status !== 200) throw new Error(`Fixture login failed: ${JSON.stringify(response.body)}`);
  return { token: response.body.data.tokens.accessToken as string, userId: user.id };
}

interface RegisteredDriver {
  accessToken: string;
  userId: string;
  driverProfileId: string;
}

async function registerDriver(licenseNumber?: string): Promise<RegisteredDriver> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-docmgmt-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Doc',
      lastName: 'Mgmt',
      licenseNumber: licenseNumber ?? `DL-${randomUUID()}`,
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

async function latestAuditLogFor(entityId: string): Promise<typeof schema.auditLogs.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(schema.auditLogs.createdAt);
  return row;
}

const TINY_JPEG_BASE64 = Buffer.from('not-a-real-jpeg-but-fine-for-a-mock-store').toString('base64');

beforeAll(async () => {
  const admin = await createUserAndLogin('ADMIN');
  adminToken = admin.token;

  const passengerRegister = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-docmgmt-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Doc',
      lastName: 'Mgmt',
    });
  passengerToken = passengerRegister.body.data.tokens.accessToken;
});

afterAll(async () => {
  await pool.end();
});

describe('Driver document upload (Phase 15)', () => {
  it('uploads a document and lists it back, PENDING by default', async () => {
    const driver = await registerDriver();

    const uploadResponse = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({
        documentType: 'DRIVER_LICENSE',
        contentBase64: TINY_JPEG_BASE64,
        contentType: 'image/jpeg',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.data).toMatchObject({
      documentType: 'DRIVER_LICENSE',
      reviewStatus: 'PENDING',
      rejectionReason: null,
    });

    const listResponse = await request(app)
      .get('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].id).toBe(uploadResponse.body.data.id);
  });

  it('a document with no expiresAt (e.g. a profile photo) uploads fine', async () => {
    const driver = await registerDriver();

    const response = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({
        documentType: 'PROFILE_PHOTO',
        contentBase64: TINY_JPEG_BASE64,
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.expiresAt).toBeNull();
  });

  it('rejects an invalid documentType with 400', async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'PASSPORT', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });
    expect(response.status).toBe(400);
  });

  it('rejects malformed base64 with 400', async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'INSURANCE', contentBase64: 'not base64!!! ###', contentType: 'image/jpeg' });
    expect(response.status).toBe(400);
  });

  it('a second upload of the same document type does not overwrite the first', async () => {
    const driver = await registerDriver();
    await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'INSURANCE', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });
    await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'INSURANCE', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });

    const listResponse = await request(app)
      .get('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`);
    expect(listResponse.body.data).toHaveLength(2);
  });

  it('blocks a passenger from the driver document endpoints (403)', async () => {
    const response = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({ documentType: 'DRIVER_LICENSE', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });
    expect(response.status).toBe(403);
  });
});

describe('Admin "request replacement" (Phase 15)', () => {
  it('requests a replacement for a PENDING document, requires a reason, and audits', async () => {
    const driver = await registerDriver();
    const uploadResponse = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'DRIVER_LICENSE', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });
    const documentId = uploadResponse.body.data.id as string;

    const missingReason = await request(app)
      .post(`/admin/documents/${documentId}/request-replacement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(missingReason.status).toBe(400);

    const response = await request(app)
      .post(`/admin/documents/${documentId}/request-replacement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Photo is expiring soon, please re-upload a current one.' });

    expect(response.status).toBe(200);
    expect(response.body.data.reviewStatus).toBe('REPLACEMENT_REQUESTED');
    expect(response.body.data.rejectionReason).toBe(
      'Photo is expiring soon, please re-upload a current one.',
    );

    const audit = await latestAuditLogFor(documentId);
    expect(audit?.action).toBe('document.request_replacement');
  });

  it('cannot request a replacement for an already-rejected document (409)', async () => {
    const driver = await registerDriver();
    const uploadResponse = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ documentType: 'DRIVER_LICENSE', contentBase64: TINY_JPEG_BASE64, contentType: 'image/jpeg' });
    const documentId = uploadResponse.body.data.id as string;

    await request(app)
      .post(`/admin/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: false, rejectionReason: 'Illegible' });

    const response = await request(app)
      .post(`/admin/documents/${documentId}/request-replacement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Please re-upload' });
    expect(response.status).toBe(409);
  });

  it('404s for an unknown document id', async () => {
    const response = await request(app)
      .post(`/admin/documents/${randomUUID()}/request-replacement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'test' });
    expect(response.status).toBe(404);
  });
});

describe('Admin document expiration filter + dashboard (Phase 15)', () => {
  it('lists only documents expiring within the given window once approved', async () => {
    const driver = await registerDriver();
    const uploadResponse = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({
        documentType: 'DRIVER_LICENSE',
        contentBase64: TINY_JPEG_BASE64,
        contentType: 'image/jpeg',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days out
      });
    const documentId = uploadResponse.body.data.id as string;

    // Not APPROVED yet — the expiration filter only counts in-service documents.
    const beforeApproval = await request(app)
      .get('/admin/documents?expiringWithinDays=30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(beforeApproval.body.data.some((row: { id: string }) => row.id === documentId)).toBe(false);

    await request(app)
      .post(`/admin/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved: true });

    const afterApproval = await request(app)
      .get('/admin/documents?expiringWithinDays=30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterApproval.status).toBe(200);
    expect(afterApproval.body.data.some((row: { id: string }) => row.id === documentId)).toBe(true);

    const tooNarrow = await request(app)
      .get('/admin/documents?expiringWithinDays=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tooNarrow.body.data.some((row: { id: string }) => row.id === documentId)).toBe(false);
  });

  it('rejects a non-numeric expiringWithinDays with 400', async () => {
    const response = await request(app)
      .get('/admin/documents?expiringWithinDays=soon')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });

  it('dashboard summary includes expiringDocumentsCount as a number', async () => {
    const response = await request(app).get('/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(typeof response.body.data.expiringDocumentsCount).toBe('number');
  });
});

describe('BackgroundCheckProvider (MOCK ONLY) wired into driver moderation (Phase 15)', () => {
  it('runs a check for a driver, defaults to PASSED, and audits', async () => {
    const driver = await registerDriver();

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/background-check`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PASSED');
    expect(response.body.data.completedAt).not.toBeNull();

    const audit = await latestAuditLogFor(driver.driverProfileId);
    expect(audit?.action).toBe('driver.background_check');

    const detailResponse = await request(app)
      .get(`/admin/drivers/${driver.driverProfileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.body.data.latestBackgroundCheck).toMatchObject({ status: 'PASSED' });
  });

  it('fails deterministically for the mock-fail- license number test hook', async () => {
    const driver = await registerDriver(`MOCK-FAIL-${randomUUID()}`);

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/background-check`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('FAILED');
  });

  it("a driver's detail shows no latestBackgroundCheck before one has ever been run", async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .get(`/admin/drivers/${driver.driverProfileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.body.data.latestBackgroundCheck).toBeNull();
  });

  it('is available to a plain ADMIN, not SUPER_ADMIN-gated (routine action, unlike suspend)', async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/background-check`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(201);
  });

  it('404s for an unknown driver id', async () => {
    const response = await request(app)
      .post(`/admin/drivers/${randomUUID()}/background-check`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  it('blocks a passenger from triggering a background check (403)', async () => {
    const driver = await registerDriver();
    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/background-check`)
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(response.status).toBe(403);
  });
});
