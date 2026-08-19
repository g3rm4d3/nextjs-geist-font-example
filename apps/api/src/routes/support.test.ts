import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

/**
 * Phase 18 — Support System. Section 18: "Passenger App and Driver App:
 * create support ticket. Ticket can reference ride." + "Admin App:
 * review, reply, internal note, change status." Phase 14 already built
 * admin review (list/detail); Phase 16 already built admin reply +
 * internal note. This phase adds ticket creation (the only writer of
 * support_tickets in Stage 1) and admin status changes.
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
    .values({ name: `support-test-${randomUUID()}`, active: true, ...TEST_CONFIG })
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
      email: `passenger-support-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Support',
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
      email: `driver-support-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Support',
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

function rideRequestBody(pickup: Point) {
  return {
    pickup: { coordinate: pickup, label: 'Test Pickup' },
    destination: { coordinate: destinationNear(pickup), label: 'Test Destination' },
    idempotencyKey: randomUUID(),
  };
}

/** A ride belonging to a fresh passenger, no driver needed —
 * SEARCHING_DRIVER is enough for the ownership check under test. */
async function createOwnRide(passenger: RegisteredUser): Promise<string> {
  const response = await request(app)
    .post('/rides')
    .set('Authorization', `Bearer ${passenger.accessToken}`)
    .send(rideRequestBody(uniquePickup()));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** Registers a passenger + one eligible driver, requests a ride, and
 * accepts it — leaving the ride at DRIVER_ASSIGNED, owned by both. */
async function setUpAssignedRide(): Promise<{
  rideId: string;
  passenger: RegisteredUser;
  driver: RegisteredDriver;
}> {
  const pickup = uniquePickup();
  const passenger = await registerPassenger();
  const driver = await registerDriver();
  await makeEligible(driver.driverProfileId, pickup);

  const rideResponse = await request(app)
    .post('/rides')
    .set('Authorization', `Bearer ${passenger.accessToken}`)
    .send(rideRequestBody(pickup));
  const rideId = rideResponse.body.data.id as string;

  const [offer] = await db
    .select()
    .from(schema.rideRequests)
    .where(and(eq(schema.rideRequests.rideId, rideId), eq(schema.rideRequests.status, 'OFFERED')));
  if (!offer) throw new Error('Expected a driver offer to have been created');

  await request(app)
    .post(`/drivers/me/offer/${offer.id}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`);

  return { rideId, passenger, driver };
}

async function adminToken(role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN'): Promise<string> {
  const email = `admin-support-${randomUUID()}@example-test.test`;
  const passwordHash = await hashPassword('abcd1234');
  await db.insert(schema.users).values({ email, passwordHash, role });
  const response = await request(app).post('/auth/login').send({ email, password: 'abcd1234' });
  return response.body.data.tokens.accessToken as string;
}

async function latestAuditLogFor(entityId: string): Promise<typeof schema.auditLogs.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(desc(schema.auditLogs.createdAt));
  return row;
}

async function notificationsFor(userId: string): Promise<(typeof schema.notifications.$inferSelect)[]> {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt));
}

describe('Creating a support ticket (Phase 18)', () => {
  it('lets a passenger open a ticket with no ride reference, seeded with their own opening message', async () => {
    const passenger = await registerPassenger();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'App keeps crashing', body: 'It closes every time I open Ride History.' });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('OPEN');
    expect(response.body.data.rideId).toBeNull();
    expect(response.body.data.messages).toHaveLength(1);
    expect(response.body.data.messages[0]).toMatchObject({
      body: 'It closes every time I open Ride History.',
      isFromSupport: false,
    });
  });

  it('lets a passenger reference a ride they own', async () => {
    const passenger = await registerPassenger();
    const rideId = await createOwnRide(passenger);

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Wrong fare', body: 'I was charged more than the estimate.', rideId });

    expect(response.status).toBe(201);
    expect(response.body.data.rideId).toBe(rideId);
  });

  it('lets a driver reference a ride they were assigned', async () => {
    const { rideId, driver } = await setUpAssignedRide();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ subject: 'Passenger no-show', body: 'Waited 10 minutes, nobody came.', rideId });

    expect(response.status).toBe(201);
    expect(response.body.data.rideId).toBe(rideId);
  });

  it("rejects referencing another passenger's ride", async () => {
    const owner = await registerPassenger();
    const rideId = await createOwnRide(owner);
    const other = await registerPassenger();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ subject: 'Not mine', body: 'Trying to reference someone else’s ride.', rideId });

    expect(response.status).toBe(400);
  });

  it('rejects referencing a nonexistent ride', async () => {
    const passenger = await registerPassenger();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Ghost ride', body: 'This ride does not exist.', rideId: randomUUID() });

    expect(response.status).toBe(400);
  });

  it('rejects an empty subject or body', async () => {
    const passenger = await registerPassenger();

    const response = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: '', body: '' });

    expect(response.status).toBe(400);
  });
});

describe("Viewing one's own tickets (Phase 18)", () => {
  it('lists only the caller’s own tickets, most recent first', async () => {
    const passenger = await registerPassenger();
    const other = await registerPassenger();

    await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ subject: 'Not mine', body: 'Should never show up for `passenger`.' });

    const first = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'First ticket', body: 'First.' });
    const second = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Second ticket', body: 'Second.' });

    const listResponse = await request(app)
      .get('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(2);
    expect(listResponse.body.data[0].id).toBe(second.body.data.id);
    expect(listResponse.body.data[1].id).toBe(first.body.data.id);
  });

  it("404s for another user's ticket, and for an unknown id", async () => {
    const passenger = await registerPassenger();
    const created = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Mine', body: 'Only I can see this.' });
    const ticketId = created.body.data.id as string;

    const other = await registerPassenger();
    const wrongOwner = await request(app)
      .get(`/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(wrongOwner.status).toBe(404);

    const unknown = await request(app)
      .get(`/support/tickets/${randomUUID()}`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);
    expect(unknown.status).toBe(404);
  });

  it("never shows an admin's internal note, only their real replies", async () => {
    const passenger = await registerPassenger();
    const created = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Need help', body: 'Original message.' });
    const ticketId = created.body.data.id as string;

    const token = await adminToken();
    await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Internal-only note about this ticket.', isInternalNote: true });
    await request(app)
      .post(`/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'We are looking into this for you.' });

    const detail = await request(app)
      .get(`/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${passenger.accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.messages).toHaveLength(2);
    expect(detail.body.data.messages[0]).toMatchObject({ body: 'Original message.', isFromSupport: false });
    expect(detail.body.data.messages[1]).toMatchObject({
      body: 'We are looking into this for you.',
      isFromSupport: true,
    });
    expect(
      detail.body.data.messages.some((m: { body: string }) => m.body.includes('Internal-only')),
    ).toBe(false);
  });
});

describe('Admin change status (Phase 18)', () => {
  async function createTicketAsPassenger(): Promise<{ ticketId: string; passenger: RegisteredUser }> {
    const passenger = await registerPassenger();
    const created = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'Status test', body: 'Please look into this.' });
    return { ticketId: created.body.data.id as string, passenger };
  }

  it('changes status, audits it, and notifies the ticket owner', async () => {
    const { ticketId, passenger } = await createTicketAsPassenger();
    const token = await adminToken();

    const response = await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('IN_PROGRESS');

    const audit = await latestAuditLogFor(ticketId);
    expect(audit?.action).toBe('support.change_status');

    const notifications = await notificationsFor(passenger.userId);
    expect(notifications.some((n) => n.type === 'support.update')).toBe(true);
  });

  it('allows any status to move to any other status (no fixed transition graph)', async () => {
    const { ticketId } = await createTicketAsPassenger();
    const token = await adminToken();

    await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RESOLVED' });

    const reopened = await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' });

    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('IN_PROGRESS');
  });

  it('is available to a plain ADMIN, not SUPER_ADMIN-gated', async () => {
    const { ticketId } = await createTicketAsPassenger();
    const token = await adminToken('ADMIN');

    const response = await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLOSED' });

    expect(response.status).toBe(200);
  });

  it('rejects an invalid status value', async () => {
    const { ticketId } = await createTicketAsPassenger();
    const token = await adminToken();

    const response = await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NOT_A_REAL_STATUS' });

    expect(response.status).toBe(400);
  });

  it('404s for an unknown ticket id', async () => {
    const token = await adminToken();

    const response = await request(app)
      .patch(`/admin/support/tickets/${randomUUID()}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLOSED' });

    expect(response.status).toBe(404);
  });

  it('blocks a passenger from changing a ticket status', async () => {
    const { ticketId, passenger } = await createTicketAsPassenger();

    const response = await request(app)
      .patch(`/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ status: 'CLOSED' });

    expect(response.status).toBe(403);
  });
});

describe('Admin review still sees passenger/driver-created tickets end to end (Phase 18)', () => {
  it('a ticket created via the passenger endpoint appears in the admin list and detail views', async () => {
    const passenger = await registerPassenger();
    const created = await request(app)
      .post('/support/tickets')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ subject: 'End to end', body: 'Created by the passenger app.' });
    const ticketId = created.body.data.id as string;

    const token = await adminToken();
    const listResponse = await request(app)
      .get('/admin/support/tickets')
      .set('Authorization', `Bearer ${token}`);
    expect(listResponse.body.data.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.messages).toHaveLength(1);
    expect(detailResponse.body.data.messages[0].body).toBe('Created by the passenger app.');
  });
});
