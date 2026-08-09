import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbClient, type Database } from './client';
import { runMigrations } from './migrate';
import { createScriptPool } from './pool';
import * as schema from './schema';

/**
 * Exercises the schema against a real PostgreSQL instance (rideshare_test)
 * rather than mocking the database — the whole point of these tests is to
 * prove that FKs and CHECK constraints are actually enforced by Postgres,
 * not just declared correctly in TypeScript.
 */

const ALL_TABLES = [
  'audit_logs',
  'driver_documents',
  'driver_earnings',
  'driver_locations',
  'driver_profiles',
  'notifications',
  'passenger_profiles',
  'payment_records',
  'pricing_configs',
  'promo_codes',
  'ratings',
  'ride_events',
  'ride_location_samples',
  'ride_requests',
  'rides',
  'support_messages',
  'support_tickets',
  'system_settings',
  'users',
  'vehicles',
];

let pool: Pool;
let db: Database;

beforeAll(async () => {
  await runMigrations();
  pool = createScriptPool();
  db = createDbClient(pool);
});

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

/**
 * drizzle-orm wraps driver errors in a DrizzleQueryError whose own
 * `.message` is just "Failed query: ...; params: ..." — the real Postgres
 * detail (and, critically, the constraint name) lives on `.cause`. Plain
 * `.rejects.toThrow(/constraint_name/)` matches against the wrapper's
 * message and always fails, so every constraint assertion goes through
 * this helper instead.
 */
async function expectPgError(promise: Promise<unknown>, constraintOrPattern: string | RegExp) {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error('Expected the query to reject with a Postgres error, but it resolved');
  }

  const cause = (thrown as { cause?: { message?: string } }).cause;
  const message = cause?.message ?? (thrown as Error).message;

  if (typeof constraintOrPattern === 'string') {
    expect(message).toContain(constraintOrPattern);
  } else {
    expect(message).toMatch(constraintOrPattern);
  }
}

async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'jane.doe@example-dev.test', role: 'PASSENGER', ...overrides })
    .returning();
  if (!user) throw new Error('insert failed');
  return user;
}

describe('users', () => {
  it('rejects a duplicate email', async () => {
    await insertUser({ email: 'dupe@example-dev.test' });
    await expectPgError(insertUser({ email: 'dupe@example-dev.test' }), 'users_email_key');
  });

  it('rejects a non-lowercase email', async () => {
    await expectPgError(
      insertUser({ email: 'Jane.Doe@Example-Dev.Test' }),
      'users_email_lowercase_chk',
    );
  });

  it('allows two users with a null phone (unique index permits multiple NULLs)', async () => {
    await insertUser({ email: 'a@example-dev.test', phone: null });
    await expect(insertUser({ email: 'b@example-dev.test', phone: null })).resolves.toBeDefined();
  });
});

describe('passenger_profiles', () => {
  it('cascades on user deletion', async () => {
    const user = await insertUser();
    await db.insert(schema.passengerProfiles).values({
      userId: user.id,
      firstName: 'Jane',
      lastName: 'Doe',
    });

    await db.delete(schema.users).where(eq(schema.users.id, user.id));

    const remaining = await db
      .select()
      .from(schema.passengerProfiles)
      .where(eq(schema.passengerProfiles.userId, user.id));
    expect(remaining).toHaveLength(0);
  });

  it('rejects a passenger_profile with no matching user', async () => {
    await expectPgError(
      db.insert(schema.passengerProfiles).values({
        userId: '00000000-0000-0000-0000-000000000000',
        firstName: 'Ghost',
        lastName: 'User',
      }),
      'passenger_profiles_user_id_users_id_fk',
    );
  });
});

describe('driver_profiles', () => {
  async function insertDriver(overrides: Partial<typeof schema.driverProfiles.$inferInsert> = {}) {
    const user = await insertUser({ email: 'driver@example-dev.test', role: 'DRIVER' });
    return db
      .insert(schema.driverProfiles)
      .values({
        userId: user.id,
        firstName: 'Dana',
        lastName: 'Driver',
        licenseNumber: `DL-${crypto.randomUUID()}`,
        licenseState: 'CA',
        onboardingStatus: 'DRAFT',
        ...overrides,
      })
      .returning();
  }

  it('rejects an ONLINE driver whose onboarding is not APPROVED', async () => {
    await expectPgError(
      insertDriver({ onboardingStatus: 'PENDING_REVIEW', availabilityStatus: 'ONLINE' }),
      'driver_profiles_availability_requires_approval_chk',
    );
  });

  it('allows an OFFLINE driver regardless of onboarding status', async () => {
    await expect(
      insertDriver({ onboardingStatus: 'PENDING_REVIEW', availabilityStatus: 'OFFLINE' }),
    ).resolves.toBeDefined();
  });

  it('allows an ONLINE driver once APPROVED', async () => {
    await expect(
      insertDriver({ onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE' }),
    ).resolves.toBeDefined();
  });
});

describe('vehicles', () => {
  async function insertApprovedDriver() {
    const user = await insertUser({ email: 'vehicle-driver@example-dev.test', role: 'DRIVER' });
    const [driver] = await db
      .insert(schema.driverProfiles)
      .values({
        userId: user.id,
        firstName: 'Dana',
        lastName: 'Driver',
        licenseNumber: `DL-${crypto.randomUUID()}`,
        licenseState: 'CA',
        onboardingStatus: 'APPROVED',
      })
      .returning();
    if (!driver) throw new Error('insert failed');
    return driver;
  }

  it('allows only one active vehicle per driver at a time', async () => {
    const driver = await insertApprovedDriver();
    await db.insert(schema.vehicles).values({
      driverId: driver.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      color: 'Black',
      licensePlate: 'ABC123',
      seats: 4,
      isActive: true,
    });

    await expectPgError(
      db.insert(schema.vehicles).values({
        driverId: driver.id,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        color: 'White',
        licensePlate: 'XYZ789',
        seats: 4,
        isActive: true,
      }),
      'vehicles_one_active_per_driver_key',
    );
  });

  it('allows a second inactive vehicle for the same driver', async () => {
    const driver = await insertApprovedDriver();
    await db.insert(schema.vehicles).values({
      driverId: driver.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      color: 'Black',
      licensePlate: 'ABC123',
      seats: 4,
      isActive: true,
    });

    await expect(
      db.insert(schema.vehicles).values({
        driverId: driver.id,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        color: 'White',
        licensePlate: 'XYZ789',
        seats: 4,
        isActive: false,
      }),
    ).resolves.toBeDefined();
  });
});

describe('ratings', () => {
  it('allows only one rating per (ride, direction)', async () => {
    const passenger = await insertUser({ email: 'passenger@example-dev.test', role: 'PASSENGER' });
    const driverUser = await insertUser({ email: 'driver2@example-dev.test', role: 'DRIVER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'One' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');

    const [ride] = await db
      .insert(schema.rides)
      .values({
        passengerId: passengerProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '1 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '2 Main St',
        destinationLat: 0,
        destinationLng: 0,
      })
      .returning();
    if (!ride) throw new Error('insert failed');

    await db.insert(schema.ratings).values({
      rideId: ride.id,
      raterUserId: passenger.id,
      rateeUserId: driverUser.id,
      direction: 'PASSENGER_TO_DRIVER',
      stars: 5,
    });

    await expectPgError(
      db.insert(schema.ratings).values({
        rideId: ride.id,
        raterUserId: passenger.id,
        rateeUserId: driverUser.id,
        direction: 'PASSENGER_TO_DRIVER',
        stars: 3,
      }),
      'ratings_ride_direction_key',
    );
  });

  it('rejects a star rating outside 1-5', async () => {
    const passenger = await insertUser({ email: 'passenger2@example-dev.test', role: 'PASSENGER' });
    const driverUser = await insertUser({ email: 'driver3@example-dev.test', role: 'DRIVER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Two' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');
    const [ride] = await db
      .insert(schema.rides)
      .values({
        passengerId: passengerProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '1 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '2 Main St',
        destinationLat: 0,
        destinationLng: 0,
      })
      .returning();
    if (!ride) throw new Error('insert failed');

    await expectPgError(
      db.insert(schema.ratings).values({
        rideId: ride.id,
        raterUserId: passenger.id,
        rateeUserId: driverUser.id,
        direction: 'PASSENGER_TO_DRIVER',
        stars: 6,
      }),
      'ratings_stars_range_chk',
    );
  });
});

describe('driver_earnings', () => {
  it('rejects a ledger row where the driver amount does not balance', async () => {
    const passenger = await insertUser({ email: 'passenger3@example-dev.test', role: 'PASSENGER' });
    const driverUser = await insertUser({ email: 'driver4@example-dev.test', role: 'DRIVER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Three' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');
    const [driverProfile] = await db
      .insert(schema.driverProfiles)
      .values({
        userId: driverUser.id,
        firstName: 'D',
        lastName: 'Four',
        licenseNumber: `DL-${crypto.randomUUID()}`,
        licenseState: 'CA',
        onboardingStatus: 'APPROVED',
      })
      .returning();
    if (!driverProfile) throw new Error('insert failed');
    const [ride] = await db
      .insert(schema.rides)
      .values({
        passengerId: passengerProfile.id,
        driverId: driverProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '1 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '2 Main St',
        destinationLat: 0,
        destinationLng: 0,
        status: 'COMPLETED',
      })
      .returning();
    if (!ride) throw new Error('insert failed');

    await expectPgError(
      db.insert(schema.driverEarnings).values({
        rideId: ride.id,
        driverId: driverProfile.id,
        grossFareCents: 1000,
        platformCommissionCents: 200,
        driverGrossEarningsCents: 900, // should be 800 — deliberately wrong
      }),
      'driver_earnings_balance_chk',
    );
  });
});

describe('rides', () => {
  it('rejects an out-of-range latitude', async () => {
    const passenger = await insertUser({ email: 'passenger4@example-dev.test', role: 'PASSENGER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Five' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');

    await expectPgError(
      db.insert(schema.rides).values({
        passengerId: passengerProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '1 Main St',
        pickupLat: 999,
        pickupLng: 0,
        destinationAddress: '2 Main St',
        destinationLat: 0,
        destinationLng: 0,
      }),
      'rides_pickup_lat_range_chk',
    );
  });

  it('restricts deleting a driver_profile referenced by a ride', async () => {
    const passenger = await insertUser({ email: 'passenger5@example-dev.test', role: 'PASSENGER' });
    const driverUser = await insertUser({ email: 'driver5@example-dev.test', role: 'DRIVER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Six' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');
    const [driverProfile] = await db
      .insert(schema.driverProfiles)
      .values({
        userId: driverUser.id,
        firstName: 'D',
        lastName: 'Six',
        licenseNumber: `DL-${crypto.randomUUID()}`,
        licenseState: 'CA',
        onboardingStatus: 'APPROVED',
      })
      .returning();
    if (!driverProfile) throw new Error('insert failed');
    await db.insert(schema.rides).values({
      passengerId: passengerProfile.id,
      driverId: driverProfile.id,
      idempotencyKey: crypto.randomUUID(),
      pickupAddress: '1 Main St',
      pickupLat: 0,
      pickupLng: 0,
      destinationAddress: '2 Main St',
      destinationLat: 0,
      destinationLng: 0,
    });

    await expectPgError(
      db.delete(schema.driverProfiles).where(eq(schema.driverProfiles.id, driverProfile.id)),
      'rides_driver_id_driver_profiles_id_fk',
    );
  });

  it('rejects a second ride with the same (passenger, idempotency key)', async () => {
    const passenger = await insertUser({ email: 'passenger6@example-dev.test', role: 'PASSENGER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Seven' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');
    const idempotencyKey = crypto.randomUUID();

    await db.insert(schema.rides).values({
      passengerId: passengerProfile.id,
      idempotencyKey,
      pickupAddress: '1 Main St',
      pickupLat: 0,
      pickupLng: 0,
      destinationAddress: '2 Main St',
      destinationLat: 0,
      destinationLng: 0,
      status: 'COMPLETED', // terminal, so this doesn't also trip the one-active-ride constraint
    });

    await expectPgError(
      db.insert(schema.rides).values({
        passengerId: passengerProfile.id,
        idempotencyKey,
        pickupAddress: '3 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '4 Main St',
        destinationLat: 0,
        destinationLng: 0,
      }),
      'rides_passenger_idempotency_key_key',
    );
  });

  it('rejects a second active ride for a passenger who already has one (Phase 7)', async () => {
    const passenger = await insertUser({ email: 'passenger7@example-dev.test', role: 'PASSENGER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Eight' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');

    await db.insert(schema.rides).values({
      passengerId: passengerProfile.id,
      idempotencyKey: crypto.randomUUID(),
      pickupAddress: '1 Main St',
      pickupLat: 0,
      pickupLng: 0,
      destinationAddress: '2 Main St',
      destinationLat: 0,
      destinationLng: 0,
      status: 'SEARCHING_DRIVER',
    });

    await expectPgError(
      db.insert(schema.rides).values({
        passengerId: passengerProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '3 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '4 Main St',
        destinationLat: 0,
        destinationLng: 0,
        status: 'REQUESTED',
      }),
      'rides_one_active_per_passenger_key',
    );
  });

  it('allows a new active ride once the previous one is terminal', async () => {
    const passenger = await insertUser({ email: 'passenger8@example-dev.test', role: 'PASSENGER' });
    const [passengerProfile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: passenger.id, firstName: 'P', lastName: 'Nine' })
      .returning();
    if (!passengerProfile) throw new Error('insert failed');

    await db.insert(schema.rides).values({
      passengerId: passengerProfile.id,
      idempotencyKey: crypto.randomUUID(),
      pickupAddress: '1 Main St',
      pickupLat: 0,
      pickupLng: 0,
      destinationAddress: '2 Main St',
      destinationLat: 0,
      destinationLng: 0,
      status: 'CANCELLED_BY_PASSENGER',
      cancelledAt: new Date(),
      cancelledBy: 'PASSENGER',
    });

    await expect(
      db.insert(schema.rides).values({
        passengerId: passengerProfile.id,
        idempotencyKey: crypto.randomUUID(),
        pickupAddress: '3 Main St',
        pickupLat: 0,
        pickupLng: 0,
        destinationAddress: '4 Main St',
        destinationLat: 0,
        destinationLng: 0,
        status: 'REQUESTED',
      }),
    ).resolves.toBeDefined();
  });
});
