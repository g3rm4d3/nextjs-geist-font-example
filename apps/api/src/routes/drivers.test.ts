import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

// A factory, not a shared constant: the license plate must be unique per
// vehicle (vehicles_license_plate_key), and most tests below register a
// fresh driver and give it its own new vehicle.
function makeVehiclePayload(): {
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  seats: number;
} {
  return {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    color: 'Silver',
    licensePlate: `DEV-${randomUUID().slice(0, 8)}`,
    seats: 4,
  };
}

interface RegisteredDriver {
  accessToken: string;
  driverProfileId: string;
}

async function registerDriver(): Promise<RegisteredDriver> {
  const response = await request(app)
    .post('/auth/drivers/register')
    .send({
      email: `driver-${randomUUID()}@example-test.test`,
      password: 'abcd1234',
      firstName: 'Test',
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

  return { accessToken, driverProfileId: profile.id };
}

/** Directly promotes a driver to APPROVED — there is no public API for
 * this yet (admin approval is Phase 14), exactly like the admin fixture
 * accounts in authorization.test.ts are provisioned outside the API. */
async function approveDriver(driverProfileId: string): Promise<void> {
  await db
    .update(schema.driverProfiles)
    .set({ onboardingStatus: 'APPROVED' })
    .where(eq(schema.driverProfiles.id, driverProfileId));
}

describe('GET /drivers/me/profile', () => {
  it('returns DRAFT status and no vehicle for a freshly registered driver', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .get('/drivers/me/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      onboardingStatus: 'DRAFT',
      availabilityStatus: 'OFFLINE',
      vehicle: null,
    });
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/drivers/me/profile');
    expect(response.status).toBe(401);
  });
});

describe('PUT /drivers/me/vehicle', () => {
  it('creates a vehicle for a driver with none yet', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(makeVehiclePayload());

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      color: 'Silver',
      seats: 4,
      vin: null,
    });

    const profileResponse = await request(app)
      .get('/drivers/me/profile')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(profileResponse.body.data.vehicle).not.toBeNull();
  });

  it('updates the same active vehicle in place on a second submission', async () => {
    const { accessToken } = await registerDriver();
    const vehiclePayload = makeVehiclePayload();

    const first = await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(vehiclePayload);
    const firstVehicleId = first.body.data.id;

    const second = await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...vehiclePayload, color: 'Blue' });

    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(firstVehicleId);
    expect(second.body.data.color).toBe('Blue');
  });

  it('rejects an invalid vehicle payload with 400', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...makeVehiclePayload(), year: 1900 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a passenger with 403', async () => {
    const registerResponse = await request(app)
      .post('/auth/passengers/register')
      .send({
        email: `passenger-${randomUUID()}@example-test.test`,
        password: 'abcd1234',
        firstName: 'Test',
        lastName: 'Passenger',
      });
    const passengerToken = registerResponse.body.data.tokens.accessToken as string;

    const response = await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(makeVehiclePayload());

    expect(response.status).toBe(403);
  });
});

describe('POST /drivers/me/submit-application', () => {
  it('rejects submission with no vehicle on file', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .post('/drivers/me/submit-application')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('moves DRAFT -> PENDING_REVIEW once a vehicle exists', async () => {
    const { accessToken } = await registerDriver();
    await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(makeVehiclePayload());

    const response = await request(app)
      .post('/drivers/me/submit-application')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingStatus).toBe('PENDING_REVIEW');
  });

  it('rejects a second submission once already past DRAFT', async () => {
    const { accessToken } = await registerDriver();
    await request(app)
      .put('/drivers/me/vehicle')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(makeVehiclePayload());
    await request(app)
      .post('/drivers/me/submit-application')
      .set('Authorization', `Bearer ${accessToken}`);

    const response = await request(app)
      .post('/drivers/me/submit-application')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe('PATCH /drivers/me/availability', () => {
  it('allows a non-approved driver to (redundantly) go OFFLINE', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .patch('/drivers/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'OFFLINE' });

    expect(response.status).toBe(200);
    expect(response.body.data.availabilityStatus).toBe('OFFLINE');
  });

  it('blocks a non-approved (DRAFT) driver from going ONLINE with 403', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .patch('/drivers/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'ONLINE' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an APPROVED driver to go ONLINE, then OFFLINE again', async () => {
    const { accessToken, driverProfileId } = await registerDriver();
    await approveDriver(driverProfileId);

    const online = await request(app)
      .patch('/drivers/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'ONLINE' });
    expect(online.status).toBe(200);
    expect(online.body.data.availabilityStatus).toBe('ONLINE');

    const offline = await request(app)
      .patch('/drivers/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'OFFLINE' });
    expect(offline.status).toBe(200);
    expect(offline.body.data.availabilityStatus).toBe('OFFLINE');
  });

  it('rejects an invalid status value with 400', async () => {
    const { accessToken } = await registerDriver();

    const response = await request(app)
      .patch('/drivers/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'BUSY' });

    expect(response.status).toBe(400);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .patch('/drivers/me/availability')
      .send({ status: 'ONLINE' });
    expect(response.status).toBe(401);
  });
});
