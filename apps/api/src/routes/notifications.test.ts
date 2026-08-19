import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';
import { sweepExpiringDocuments } from '../services/documentService';
import { refundPayment } from '../services/paymentService';

/**
 * Phase 16 — the NotificationProvider abstraction applied: every one of
 * Section 16's 11 canonical events actually fires an in-app notification
 * row through the real ride/payment/driver-moderation/document/support
 * flows (not a unit test against notificationService in isolation), plus
 * the list/read/read-all/push-token surface those events feed into.
 */

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

beforeAll(async () => {
  await db
    .update(schema.pricingConfigs)
    .set({ active: false })
    .where(eq(schema.pricingConfigs.active, true));

  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `notifications-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await pool.end();
});

interface Point {
  latitude: number;
  longitude: number;
}

// Same reasoning as every other Phase 7+ test file: a unique pickup per
// test so drivers made ONLINE + located in one test can never be
// candidates in a later test that happens to request a ride nearby.
function uniquePickup(): Point {
  return { latitude: Math.random() * 140 - 70, longitude: Math.random() * 340 - 170 };
}

function destinationNear(pickup: Point): Point {
  return { latitude: pickup.latitude - 0.01, longitude: pickup.longitude };
}

interface RegisteredUser {
  accessToken: string;
  userId: string;
}

async function registerPassenger(): Promise<RegisteredUser> {
  const response = await request(app)
    .post('/auth/passengers/register')
    .send({
      email: `passenger-notif-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Notif',
      lastName: 'Passenger',
    });
  return {
    accessToken: response.body.data.tokens.accessToken as string,
    userId: response.body.data.user.id as string,
  };
}

interface RegisteredDriver extends RegisteredUser {
  driverProfileId: string;
}

async function registerDriver(): Promise<RegisteredDriver> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-notif-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Notif',
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

  return { accessToken, userId, driverProfileId: profile.id };
}

async function makeEligible(driverProfileId: string, pickup: Point): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' })
    .where(eq(schema.driverProfiles.id, driverProfileId));

  await db.insert(schema.driverLocations).values({
    driverId: driverProfileId,
    latitude: pickup.latitude + 0.005,
    longitude: pickup.longitude,
    recordedAt: new Date(),
  });
}

async function registerEligibleDriver(pickup: Point): Promise<RegisteredDriver> {
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup);
  return driver;
}

function rideRequestBody(pickup: Point) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
  };
}

async function adminToken(): Promise<string> {
  const email = `admin-notif-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role: 'ADMIN' });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  return response.body.data.tokens.accessToken as string;
}

async function notificationsFor(
  userId: string,
): Promise<(typeof schema.notifications.$inferSelect)[]> {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt));
}

/** Requests a ride, accepts it, and walks it all the way through to
 * COMPLETED — enough to exercise every ride-lifecycle + payment
 * notification event in one pass. */
async function driveRideToCompleted(): Promise<{
  rideId: string;
  passenger: RegisteredUser;
  driver: RegisteredDriver;
}> {
  const pickup = uniquePickup();
  const passenger = await registerPassenger();
  const driver = await registerEligibleDriver(pickup);

  const rideResponse = await request(app)
    .post('/rides')
    .set('Authorization', `Bearer ${passenger.accessToken}`)
    .send(rideRequestBody(pickup));
  expect(rideResponse.status).toBe(201);
  const rideId = rideResponse.body.data.id as string;

  const [offer] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
  if (!offer) throw new Error('Expected a driver offer to have been created');

  await request(app)
    .post(`/drivers/me/offer/${offer.id}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`);

  const auth = { Authorization: `Bearer ${driver.accessToken}` };
  await request(app).post(`/drivers/me/rides/${rideId}/en-route`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(auth);
  await request(app).post(`/drivers/me/rides/${rideId}/start`).set(auth);
  const completed = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(auth);
  expect(completed.status).toBe(200);
  expect(completed.body.data.status).toBe('COMPLETED');

  return { rideId, passenger, driver };
}

describe('Ride/payment notification events (Phase 16)', () => {
  it('fires ride.requested, ride.accepted, driver_approaching/arrived, ride.started, ride.completed, and payment.status — all to the passenger', async () => {
    const { rideId, passenger } = await driveRideToCompleted();

    const events = await notificationsFor(passenger.userId);
    const types = events.map((event) => event.type);

    expect(types).toContain('ride.requested');
    expect(types).toContain('ride.accepted');
    expect(types).toContain('ride.driver_approaching');
    expect(types).toContain('ride.driver_arrived');
    expect(types).toContain('ride.started');
    expect(types).toContain('ride.completed');
    expect(types).toContain('payment.status');

    const rideRequested = events.find((event) => event.type === 'ride.requested');
    expect(rideRequested?.data).toMatchObject({ rideId });

    const paymentStatus = events.find((event) => event.type === 'payment.status');
    expect(paymentStatus?.data).toMatchObject({ rideId, status: 'SUCCEEDED' });

    // markPassengerOnboard has no Section 16 event — see
    // rideLifecycleService's own comment on why.
    expect(types).not.toContain('passenger.onboard');
  });

  it('a refund fires its own payment.status(REFUNDED) notification', async () => {
    const { rideId, passenger } = await driveRideToCompleted();

    const [record] = await db
      .select()
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.rideId, rideId));
    if (!record) throw new Error('Expected the auto-charge to have created a payment record');

    await refundPayment(record.id, 'Test refund');

    const events = await notificationsFor(passenger.userId);
    const refunded = events.find(
      (event) => event.type === 'payment.status' && (event.data as { status?: string })?.status === 'REFUNDED',
    );
    expect(refunded).toBeDefined();
  });
});

async function setOnboardingStatus(
  driverProfileId: string,
  status: (typeof schema.driverOnboardingStatusEnum.enumValues)[number],
): Promise<void> {
  await db.update(schema.driverProfiles).set({ onboardingStatus: status }).where(
    eq(schema.driverProfiles.id, driverProfileId),
  );
}

describe('Driver moderation notification events (Phase 16)', () => {
  it('fires driver.approved on approval', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'PENDING_REVIEW');
    const token = await adminToken();

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);

    const events = await notificationsFor(driver.userId);
    expect(events.some((event) => event.type === 'driver.approved')).toBe(true);
  });

  it('fires driver.rejected with the reason on rejection', async () => {
    const driver = await registerDriver();
    await setOnboardingStatus(driver.driverProfileId, 'PENDING_REVIEW');
    const token = await adminToken();

    const response = await request(app)
      .post(`/admin/drivers/${driver.driverProfileId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Illegible license photo' });
    expect(response.status).toBe(200);

    const events = await notificationsFor(driver.userId);
    const rejected = events.find((event) => event.type === 'driver.rejected');
    expect(rejected).toBeDefined();
    expect(rejected?.body).toContain('Illegible license photo');
  });
});

describe('Document expiration sweep (Phase 16)', () => {
  const TINY_JPEG_BASE64 = Buffer.from('not-a-real-jpeg-but-fine-for-a-mock-store').toString('base64');

  it('notifies once for a newly-expiring APPROVED document, then dedups on a repeat sweep', async () => {
    const driver = await registerDriver();
    const token = await adminToken();

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

    await request(app)
      .post(`/admin/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ approved: true });

    const firstSweepCount = await sweepExpiringDocuments();
    expect(firstSweepCount).toBeGreaterThanOrEqual(1);

    const events = await notificationsFor(driver.userId);
    const expiring = events.filter(
      (event) => event.type === 'document.expiring' && (event.data as { documentId?: string })?.documentId === documentId,
    );
    expect(expiring).toHaveLength(1);

    const [row] = await db
      .select({ expirationNotifiedAt: schema.driverDocuments.expirationNotifiedAt })
      .from(schema.driverDocuments)
      .where(eq(schema.driverDocuments.id, documentId));
    expect(row?.expirationNotifiedAt).not.toBeNull();

    // A repeat sweep must not re-notify for the same document.
    await sweepExpiringDocuments();
    const eventsAfterSecondSweep = await notificationsFor(driver.userId);
    const expiringAfterSecondSweep = eventsAfterSecondSweep.filter(
      (event) => event.type === 'document.expiring' && (event.data as { documentId?: string })?.documentId === documentId,
    );
    expect(expiringAfterSecondSweep).toHaveLength(1);
  });

  it('does not notify for a document outside the warning window', async () => {
    const driver = await registerDriver();
    const token = await adminToken();

    const uploadResponse = await request(app)
      .post('/drivers/me/documents')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({
        documentType: 'INSURANCE',
        contentBase64: TINY_JPEG_BASE64,
        contentType: 'image/jpeg',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(), // 1 year out
      });
    const documentId = uploadResponse.body.data.id as string;

    await request(app)
      .post(`/admin/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ approved: true });

    await sweepExpiringDocuments();

    const events = await notificationsFor(driver.userId);
    expect(events.some((event) => event.type === 'document.expiring')).toBe(false);
  });
});

async function latestAuditLogFor(entityId: string): Promise<typeof schema.auditLogs.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(desc(schema.auditLogs.createdAt));
  return row;
}

describe('Admin support reply notification event (Phase 16)', () => {
  async function createTicketFor(userId: string): Promise<string> {
    const [ticket] = await db
      .insert(schema.supportTickets)
      .values({ userId, subject: 'Test ticket', status: 'OPEN' })
      .returning({ id: schema.supportTickets.id });
    if (!ticket) throw new Error('Failed to insert fixture support ticket');
    return ticket.id;
  }

  it('fires support.update on a real (non-internal-note) admin reply', async () => {
    const passenger = await registerPassenger();
    const token = await adminToken();
    const ticketId = await createTicketFor(passenger.userId);

    const response = await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'We are looking into this.' });

    expect(response.status).toBe(200);
    expect(response.body.data.isInternalNote).toBe(false);

    const events = await notificationsFor(passenger.userId);
    expect(events.some((event) => event.type === 'support.update')).toBe(true);
  });

  it('generates an audit record for the reply (sensitive admin operations are audited)', async () => {
    const passenger = await registerPassenger();
    const token = await adminToken();
    const ticketId = await createTicketFor(passenger.userId);

    await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'We are looking into this.' });

    const audit = await latestAuditLogFor(ticketId);
    expect(audit?.action).toBe('support.reply');
    expect(audit?.entityType).toBe('support_ticket');
  });

  it('does not fire a notification for an internal note', async () => {
    const passenger = await registerPassenger();
    const token = await adminToken();
    const ticketId = await createTicketFor(passenger.userId);

    const response = await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Internal-only note for other admins.', isInternalNote: true });

    expect(response.status).toBe(200);
    expect(response.body.data.isInternalNote).toBe(true);

    const events = await notificationsFor(passenger.userId);
    expect(events.some((event) => event.type === 'support.update')).toBe(false);
  });

  it('requires a non-empty body (400)', async () => {
    const passenger = await registerPassenger();
    const token = await adminToken();
    const ticketId = await createTicketFor(passenger.userId);

    const response = await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '' });
    expect(response.status).toBe(400);
  });

  it('404s for an unknown ticket id', async () => {
    const token = await adminToken();
    const response = await request(app)
      .post(`/admin/support/tickets/${randomUUID()}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello' });
    expect(response.status).toBe(404);
  });
});

describe('GET/POST /notifications (list, read, read-all)', () => {
  it("lists a user's own notifications, most recent first, with an unread count", async () => {
    const { passenger } = await driveRideToCompleted();

    const response = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data.notifications)).toBe(true);
    expect(response.body.data.notifications.length).toBeGreaterThan(0);
    expect(response.body.data.unreadCount).toBe(response.body.data.notifications.length);
    for (const notification of response.body.data.notifications) {
      expect(notification.readAt).toBeNull();
    }
  });

  it('marks a single notification read, idempotently, and 404s for a mismatched owner', async () => {
    const { passenger: owner } = await driveRideToCompleted();
    const other = await registerPassenger();

    const list = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    const notificationId = list.body.data.notifications[0].id as string;

    const wrongOwner = await request(app)
      .post(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(wrongOwner.status).toBe(404);

    const first = await request(app)
      .post(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.readAt).not.toBeNull();

    // Idempotent: marking an already-read notification read again is a
    // 200, not a 404/409 — see notificationsRepository.markNotificationRead.
    const second = await request(app)
      .post(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(second.status).toBe(200);
  });

  it('404s marking an unknown notification id read', async () => {
    const passenger = await registerPassenger();
    const response = await request(app)
      .post(`/notifications/${randomUUID()}/read`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('marks every one of a user\'s notifications read in one call', async () => {
    const { passenger } = await driveRideToCompleted();

    const beforeList = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${passenger.accessToken}`);
    expect(beforeList.body.data.unreadCount).toBeGreaterThan(0);

    const readAll = await request(app)
      .post('/notifications/read-all')
      .set('Authorization', `Bearer ${passenger.accessToken}`);
    expect(readAll.status).toBe(200);

    const afterList = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${passenger.accessToken}`);
    expect(afterList.body.data.unreadCount).toBe(0);
  });
});

describe('Push token registration (Phase 16)', () => {
  it('registers a push token for the authenticated user', async () => {
    const passenger = await registerPassenger();
    const token = `ExponentPushToken[${randomUUID()}]`;

    const response = await request(app)
      .post('/notifications/push-token')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ token, platform: 'ios' });
    expect(response.status).toBe(201);

    const [row] = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token));
    expect(row?.userId).toBe(passenger.userId);
    expect(row?.platform).toBe('ios');
  });

  it('re-registering the same token under a different user re-homes it, not duplicates it', async () => {
    const first = await registerPassenger();
    const second = await registerPassenger();
    const token = `ExponentPushToken[${randomUUID()}]`;

    await request(app)
      .post('/notifications/push-token')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ token });
    await request(app)
      .post('/notifications/push-token')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ token });

    const rows = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(second.userId);
  });

  it('unregisters a push token scoped to its current owner', async () => {
    const owner = await registerPassenger();
    const other = await registerPassenger();
    const token = `ExponentPushToken[${randomUUID()}]`;

    await request(app)
      .post('/notifications/push-token')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ token });

    // A non-owner's delete is a no-op — the token is untouched.
    await request(app)
      .delete('/notifications/push-token')
      .query({ token })
      .set('Authorization', `Bearer ${other.accessToken}`);
    const stillThere = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token));
    expect(stillThere).toHaveLength(1);

    const response = await request(app)
      .delete('/notifications/push-token')
      .query({ token })
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(response.status).toBe(200);

    const gone = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token));
    expect(gone).toHaveLength(0);
  });

  it('rejects an empty token with 400', async () => {
    const passenger = await registerPassenger();
    const response = await request(app)
      .post('/notifications/push-token')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ token: '' });
    expect(response.status).toBe(400);
  });
});
