import { faker } from '@faker-js/faker';
import { hashPassword } from '@rideshare/auth';
import { sql } from 'drizzle-orm';
import { createDbClient, type Database } from './client';
import { createScriptPool } from './pool';
import { maskConnectionString } from './migrate';
import { env } from './env';
import { SAMPLE_CITY_CENTER, VEHICLE_COLORS, VEHICLE_MAKES_AND_MODELS } from './seedData';
import * as schema from './schema';

// Deterministic output: re-running `npm run seed` against a freshly reset
// database always produces the same fictional data, which makes manual
// testing and bug reports reproducible.
faker.seed(1337);

const PASSENGER_COUNT = 10;
const DRIVER_COUNT = 50;
const COMMISSION_RATE = 0.2; // 20% platform commission — a seed placeholder, not the Phase 4 pricing engine.

type NewRideInput = {
  passengerUserId: string;
  passengerProfileId: string;
  driver: SeededDriver | undefined;
  status: (typeof schema.rideStatusEnum.enumValues)[number];
};

interface SeededDriver {
  userId: string;
  profileId: string;
  vehicleId: string;
}

async function main(): Promise<void> {
  const pool = createScriptPool();
  const db = createDbClient(pool);

  await assertDatabaseIsEmpty(db);

  console.log(`Seeding ${maskConnectionString(env.DATABASE_URL)} ...`);

  await seedPricingConfig(db);
  const passengers = await seedPassengers(db);
  const drivers = await seedDrivers(db);
  const approvedDrivers = drivers.filter((driver) => driver.vehicleId !== undefined) as Array<
    SeededDriver & { vehicleId: string }
  >;
  await seedRides(db, passengers, approvedDrivers);
  const adminsSeeded = await seedAdmins(db);

  console.log(
    `Done: ${PASSENGER_COUNT} passengers, ${DRIVER_COUNT} drivers, ${DRIVER_COUNT} vehicles, ` +
      `sample rides, ${adminsSeeded} admin account(s).`,
  );

  await pool.end();
}

/**
 * Admin accounts are only ever created here if SEED_ADMIN_PASSWORD is set
 * — never with a hardcoded password (section 7). There is deliberately no
 * public admin registration endpoint (section 8), so this is the one
 * sanctioned way to get a first admin account for local development;
 * production admin provisioning is out of scope for Stage 1
 * [PRODUCTION PAYMENT APPROVAL REQUIRED]-style items are tracked
 * separately in the docs, not reused here.
 */
async function seedAdmins(db: Database): Promise<number> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.log('SEED_ADMIN_PASSWORD not set — skipping admin account seeding.');
    return 0;
  }

  const passwordHash = await hashPassword(adminPassword);

  await db.insert(schema.users).values([
    { email: 'super.admin@example-dev.test', passwordHash, role: 'SUPER_ADMIN' },
    { email: 'admin@example-dev.test', passwordHash, role: 'ADMIN' },
  ]);

  return 2;
}

async function assertDatabaseIsEmpty(db: Database): Promise<void> {
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existing) {
    throw new Error(
      'Refusing to seed a non-empty database. Run `npm run db:reset` first, then `npm run db:seed`.',
    );
  }
}

async function seedPricingConfig(db: Database): Promise<void> {
  await db.insert(schema.pricingConfigs).values({
    name: 'default',
    baseFareCents: 250,
    perMileRateCents: 150,
    perMinuteRateCents: 25,
    minimumFareCents: 500,
    bookingFeeCents: 200,
    cancellationFeeCents: 500,
    platformCommissionPercentage: (COMMISSION_RATE * 100).toFixed(2),
    active: true,
  });
}

interface SeededPassenger {
  userId: string;
  profileId: string;
}

async function seedPassengers(db: Database): Promise<SeededPassenger[]> {
  const passengers: SeededPassenger[] = [];

  for (let i = 0; i < PASSENGER_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = uniqueDevEmail(firstName, lastName, i, 'passenger');

    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        phone: faker.phone.number({ style: 'international' }),
        role: 'PASSENGER',
        // No password hash: this is fictional seed data, not a real
        // credential. Phase 2's registration flow sets a real one.
        passwordHash: null,
      })
      .returning({ id: schema.users.id });

    if (!user) throw new Error('Failed to insert seed passenger user');

    const [profile] = await db
      .insert(schema.passengerProfiles)
      .values({ userId: user.id, firstName, lastName })
      .returning({ id: schema.passengerProfiles.id });

    if (!profile) throw new Error('Failed to insert seed passenger profile');

    passengers.push({ userId: user.id, profileId: profile.id });
  }

  return passengers;
}

/** onboardingStatus distribution across the 50 seeded drivers. */
function onboardingStatusForIndex(
  index: number,
): (typeof schema.driverOnboardingStatusEnum.enumValues)[number] {
  if (index < 35) return 'APPROVED';
  if (index < 41) return 'PENDING_REVIEW';
  if (index < 45) return 'REJECTED';
  if (index < 48) return 'SUSPENDED';
  return 'DRAFT';
}

function availabilityForOnboarding(
  onboardingStatus: (typeof schema.driverOnboardingStatusEnum.enumValues)[number],
): (typeof schema.driverAvailabilityStatusEnum.enumValues)[number] {
  // The DB CHECK constraint (driver_profiles_availability_requires_approval_chk)
  // forbids ONLINE/BUSY for anything but APPROVED drivers.
  if (onboardingStatus !== 'APPROVED') return 'OFFLINE';
  const roll = faker.number.float();
  if (roll < 0.4) return 'ONLINE';
  if (roll < 0.5) return 'BUSY';
  return 'OFFLINE';
}

async function seedDrivers(
  db: Database,
): Promise<Array<SeededDriver | { userId: string; profileId: string; vehicleId?: undefined }>> {
  const drivers: Array<
    SeededDriver | { userId: string; profileId: string; vehicleId?: undefined }
  > = [];

  for (let i = 0; i < DRIVER_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = uniqueDevEmail(firstName, lastName, i, 'driver');
    const onboardingStatus = onboardingStatusForIndex(i);
    const availabilityStatus = availabilityForOnboarding(onboardingStatus);

    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        phone: faker.phone.number({ style: 'international' }),
        role: 'DRIVER',
        passwordHash: null,
      })
      .returning({ id: schema.users.id });

    if (!user) throw new Error('Failed to insert seed driver user');

    const [profile] = await db
      .insert(schema.driverProfiles)
      .values({
        userId: user.id,
        firstName,
        lastName,
        licenseNumber: `DEV-DL-${String(i + 1).padStart(6, '0')}`,
        licenseState: faker.location.state({ abbreviated: true }),
        licenseExpiresAt: faker.date.future({ years: 3 }),
        onboardingStatus,
        availabilityStatus,
      })
      .returning({ id: schema.driverProfiles.id });

    if (!profile) throw new Error('Failed to insert seed driver profile');

    await seedDriverDocument(db, profile.id, onboardingStatus);

    // DRAFT drivers haven't gotten as far as registering a vehicle yet.
    if (onboardingStatus === 'DRAFT') {
      drivers.push({ userId: user.id, profileId: profile.id });
      continue;
    }

    const vehicleId = await seedVehicle(db, profile.id, i);
    drivers.push({ userId: user.id, profileId: profile.id, vehicleId });
  }

  return drivers;
}

async function seedDriverDocument(
  db: Database,
  driverId: string,
  onboardingStatus: (typeof schema.driverOnboardingStatusEnum.enumValues)[number],
): Promise<void> {
  if (onboardingStatus === 'DRAFT') return;

  const reviewStatus =
    onboardingStatus === 'REJECTED'
      ? ('REJECTED' as const)
      : onboardingStatus === 'PENDING_REVIEW'
        ? ('PENDING' as const)
        : ('APPROVED' as const);

  await db.insert(schema.driverDocuments).values({
    driverId,
    documentType: 'DRIVER_LICENSE',
    storageKey: `dev/seed/driver-licenses/${faker.string.uuid()}.jpg`,
    expiresAt: faker.date.future({ years: 3 }),
    reviewStatus,
    reviewedAt: reviewStatus === 'PENDING' ? null : faker.date.recent({ days: 30 }),
    rejectionReason: reviewStatus === 'REJECTED' ? 'Photo was blurry; please re-upload.' : null,
  });
}

async function seedVehicle(db: Database, driverId: string, index: number): Promise<string> {
  const { make, model } = faker.helpers.arrayElement(VEHICLE_MAKES_AND_MODELS);

  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      driverId,
      make,
      model,
      year: faker.number.int({ min: 2015, max: 2025 }),
      color: faker.helpers.arrayElement(VEHICLE_COLORS),
      licensePlate: `DEV${String(index + 1).padStart(4, '0')}`,
      vin: faker.vehicle.vin(),
      seats: faker.helpers.arrayElement([4, 4, 4, 6]),
    })
    .returning({ id: schema.vehicles.id });

  if (!vehicle) throw new Error('Failed to insert seed vehicle');
  return vehicle.id;
}

/** Deterministic, collision-free fictional email for seed data. */
function uniqueDevEmail(firstName: string, lastName: string, index: number, kind: string): string {
  return `${firstName}.${lastName}.${kind}${index}@example-dev.test`.toLowerCase();
}

/** Small offset (roughly within a few km) from the sample city center. */
function jitterCoordinate(base: number): number {
  return base + faker.number.float({ min: -0.05, max: 0.05, fractionDigits: 6 });
}

const RIDE_PLAN: ReadonlyArray<(typeof schema.rideStatusEnum.enumValues)[number]> = [
  ...Array.from({ length: 25 }, () => 'COMPLETED' as const),
  ...Array.from({ length: 5 }, () => 'CANCELLED_BY_PASSENGER' as const),
  ...Array.from({ length: 3 }, () => 'CANCELLED_BY_DRIVER' as const),
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'IN_PROGRESS',
  ...Array.from({ length: 2 }, () => 'REQUESTED' as const),
  'SEARCHING_DRIVER',
  'SEARCHING_DRIVER',
];

async function seedRides(
  db: Database,
  passengers: SeededPassenger[],
  approvedDrivers: Array<SeededDriver & { vehicleId: string }>,
): Promise<void> {
  const driverRideCounts = new Map<string, number>();
  const driverRatingTotals = new Map<string, { sum: number; count: number }>();

  for (const [rideIndex, status] of RIDE_PLAN.entries()) {
    const passenger = faker.helpers.arrayElement(passengers);
    const needsDriver = status !== 'REQUESTED' && status !== 'SEARCHING_DRIVER';
    const driver = needsDriver ? faker.helpers.arrayElement(approvedDrivers) : undefined;

    await seedOneRide(
      db,
      rideIndex,
      {
        passengerUserId: passenger.userId,
        passengerProfileId: passenger.profileId,
        driver,
        status,
      },
      driverRideCounts,
      driverRatingTotals,
    );
  }

  await applyDriverAggregates(db, driverRideCounts, driverRatingTotals);
}

async function seedOneRide(
  db: Database,
  rideIndex: number,
  input: NewRideInput,
  driverRideCounts: Map<string, number>,
  driverRatingTotals: Map<string, { sum: number; count: number }>,
): Promise<void> {
  const requestedAt = faker.date.recent({ days: 21 });
  const pickupLat = jitterCoordinate(SAMPLE_CITY_CENTER.lat);
  const pickupLng = jitterCoordinate(SAMPLE_CITY_CENTER.lng);
  const destinationLat = jitterCoordinate(SAMPLE_CITY_CENTER.lat);
  const destinationLng = jitterCoordinate(SAMPLE_CITY_CENTER.lng);

  const estimatedDistanceMeters = faker.number.int({ min: 800, max: 15000 });
  const estimatedDurationSeconds = faker.number.int({ min: 180, max: 1800 });
  const estimatedFareCents = 500 + Math.round(estimatedDistanceMeters * 0.15);

  const isTerminal = input.status === 'COMPLETED';
  const isCancelled = input.status.startsWith('CANCELLED_BY');

  const actualDistanceMeters = isTerminal
    ? estimatedDistanceMeters + faker.number.int({ min: -200, max: 400 })
    : null;
  const actualDurationSeconds = isTerminal
    ? estimatedDurationSeconds + faker.number.int({ min: -60, max: 180 })
    : null;
  const finalFareCents = isTerminal
    ? estimatedFareCents + faker.number.int({ min: -100, max: 300 })
    : null;

  const timeline = buildTimeline(requestedAt, input.status);

  const [ride] = await db
    .insert(schema.rides)
    .values({
      passengerId: input.passengerProfileId,
      driverId: input.driver?.profileId ?? null,
      vehicleId: input.driver?.vehicleId ?? null,
      status: input.status,
      pickupAddress: faker.location.streetAddress(),
      pickupLat,
      pickupLng,
      destinationAddress: faker.location.streetAddress(),
      destinationLat,
      destinationLng,
      estimatedDistanceMeters,
      estimatedDurationSeconds,
      estimatedFareCents,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareCents,
      requestedAt,
      matchedAt: timeline.matchedAt,
      startedAt: timeline.startedAt,
      completedAt: timeline.completedAt,
      cancelledAt: timeline.cancelledAt,
      cancelledBy: isCancelled
        ? input.status === 'CANCELLED_BY_PASSENGER'
          ? 'PASSENGER'
          : 'DRIVER'
        : null,
      cancellationReason: isCancelled
        ? faker.helpers.arrayElement([
            'Passenger no longer needs the ride',
            'Wait time too long',
            'Found alternate transportation',
          ])
        : null,
    })
    .returning({ id: schema.rides.id });

  if (!ride) throw new Error('Failed to insert seed ride');

  await seedRideEvents(db, ride.id, timeline);

  if (input.driver) {
    driverRideCounts.set(
      input.driver.profileId,
      (driverRideCounts.get(input.driver.profileId) ?? 0) + 1,
    );
  }

  if (input.status !== 'COMPLETED' || !input.driver || finalFareCents === null) return;

  await seedLocationSamples(
    db,
    ride.id,
    timeline,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
  );
  await seedPaymentAndEarnings(db, rideIndex, ride.id, input.driver.profileId, finalFareCents);
  await seedRatings(
    db,
    ride.id,
    input.passengerUserId,
    input.driver.userId,
    driverRatingTotals,
    input.driver.profileId,
  );
}

interface RideTimeline {
  status: (typeof schema.rideStatusEnum.enumValues)[number];
  matchedAt: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  onboardAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

function buildTimeline(
  requestedAt: Date,
  status: (typeof schema.rideStatusEnum.enumValues)[number],
): RideTimeline {
  const minutesLater = (mins: number) => new Date(requestedAt.getTime() + mins * 60_000);

  const timeline: RideTimeline = {
    status,
    matchedAt: null,
    enRouteAt: null,
    arrivedAt: null,
    onboardAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  };

  const order: Array<(typeof schema.rideStatusEnum.enumValues)[number]> = [
    'REQUESTED',
    'SEARCHING_DRIVER',
    'DRIVER_ASSIGNED',
    'DRIVER_EN_ROUTE',
    'DRIVER_ARRIVED',
    'PASSENGER_ONBOARD',
    'IN_PROGRESS',
    'COMPLETED',
  ];
  const reached = (state: (typeof schema.rideStatusEnum.enumValues)[number]) =>
    order.indexOf(state) <= order.indexOf(status);

  if (reached('DRIVER_ASSIGNED')) timeline.matchedAt = minutesLater(2);
  if (reached('DRIVER_EN_ROUTE')) timeline.enRouteAt = minutesLater(2.5);
  if (reached('DRIVER_ARRIVED')) timeline.arrivedAt = minutesLater(7);
  if (reached('PASSENGER_ONBOARD')) timeline.onboardAt = minutesLater(8);
  if (reached('IN_PROGRESS')) timeline.startedAt = minutesLater(9);
  if (reached('COMPLETED')) timeline.completedAt = minutesLater(24);
  if (status.startsWith('CANCELLED_BY')) timeline.cancelledAt = minutesLater(4);

  return timeline;
}

async function seedRideEvents(db: Database, rideId: string, timeline: RideTimeline): Promise<void> {
  type Row = typeof schema.rideEvents.$inferInsert;
  const events: Row[] = [];
  let previous: (typeof schema.rideStatusEnum.enumValues)[number] | null = null;

  const push = (
    newStatus: (typeof schema.rideStatusEnum.enumValues)[number],
    at: Date,
    actorType: (typeof schema.rideEventActorTypeEnum.enumValues)[number],
  ) => {
    events.push({ rideId, previousStatus: previous, newStatus, actorType, createdAt: at });
    previous = newStatus;
  };

  const requestedAt = timeline.matchedAt
    ? new Date(timeline.matchedAt.getTime() - 2 * 60_000)
    : new Date();
  push('REQUESTED', requestedAt, 'PASSENGER');
  push('SEARCHING_DRIVER', new Date(requestedAt.getTime() + 15_000), 'SYSTEM');

  if (timeline.matchedAt) push('DRIVER_ASSIGNED', timeline.matchedAt, 'SYSTEM');
  if (timeline.enRouteAt) push('DRIVER_EN_ROUTE', timeline.enRouteAt, 'DRIVER');
  if (timeline.arrivedAt) push('DRIVER_ARRIVED', timeline.arrivedAt, 'DRIVER');
  if (timeline.onboardAt) push('PASSENGER_ONBOARD', timeline.onboardAt, 'DRIVER');
  if (timeline.startedAt) push('IN_PROGRESS', timeline.startedAt, 'DRIVER');
  if (timeline.completedAt) push('COMPLETED', timeline.completedAt, 'DRIVER');
  if (timeline.cancelledAt) {
    push(
      timeline.status,
      timeline.cancelledAt,
      timeline.status === 'CANCELLED_BY_PASSENGER' ? 'PASSENGER' : 'DRIVER',
    );
  }

  await db.insert(schema.rideEvents).values(events);
}

async function seedLocationSamples(
  db: Database,
  rideId: string,
  timeline: RideTimeline,
  pickupLat: number,
  pickupLng: number,
  destinationLat: number,
  destinationLng: number,
): Promise<void> {
  if (!timeline.startedAt || !timeline.completedAt) return;

  const sampleCount = 6;
  type Row = typeof schema.rideLocationSamples.$inferInsert;
  const samples: Row[] = [];
  const totalMs = timeline.completedAt.getTime() - timeline.startedAt.getTime();

  for (let i = 0; i <= sampleCount; i++) {
    const fraction = i / sampleCount;
    samples.push({
      rideId,
      latitude: pickupLat + (destinationLat - pickupLat) * fraction,
      longitude: pickupLng + (destinationLng - pickupLng) * fraction,
      speed: faker.number.float({ min: 5, max: 25, fractionDigits: 1 }),
      heading: faker.number.float({ min: 0, max: 359, fractionDigits: 1 }),
      accuracy: faker.number.float({ min: 3, max: 15, fractionDigits: 1 }),
      recordedAt: new Date(timeline.startedAt.getTime() + totalMs * fraction),
    });
  }

  await db.insert(schema.rideLocationSamples).values(samples);
}

async function seedPaymentAndEarnings(
  db: Database,
  rideIndex: number,
  rideId: string,
  driverProfileId: string,
  finalFareCents: number,
): Promise<void> {
  await db.insert(schema.paymentRecords).values({
    rideId,
    status: 'SUCCEEDED',
    amountCents: finalFareCents,
    currency: 'usd',
    provider: 'stripe',
    providerPaymentIntentId: `pi_seed_${rideIndex}`,
    idempotencyKey: `seed-ride-${rideId}`,
  });

  const platformCommissionCents = Math.round(finalFareCents * COMMISSION_RATE);
  const driverGrossEarningsCents = finalFareCents - platformCommissionCents;

  await db.insert(schema.driverEarnings).values({
    rideId,
    driverId: driverProfileId,
    grossFareCents: finalFareCents,
    platformCommissionCents,
    driverGrossEarningsCents,
    payoutStatus: 'PENDING',
  });
}

async function seedRatings(
  db: Database,
  rideId: string,
  passengerUserId: string,
  driverUserId: string,
  driverRatingTotals: Map<string, { sum: number; count: number }>,
  driverProfileId: string,
): Promise<void> {
  const passengerToDriverStars = faker.number.int({ min: 3, max: 5 });
  const driverToPassengerStars = faker.number.int({ min: 3, max: 5 });

  await db.insert(schema.ratings).values([
    {
      rideId,
      raterUserId: passengerUserId,
      rateeUserId: driverUserId,
      direction: 'PASSENGER_TO_DRIVER',
      stars: passengerToDriverStars,
      comment: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.4 }) ?? null,
    },
    {
      rideId,
      raterUserId: driverUserId,
      rateeUserId: passengerUserId,
      direction: 'DRIVER_TO_PASSENGER',
      stars: driverToPassengerStars,
      comment: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.2 }) ?? null,
    },
  ]);

  const totals = driverRatingTotals.get(driverProfileId) ?? { sum: 0, count: 0 };
  totals.sum += passengerToDriverStars;
  totals.count += 1;
  driverRatingTotals.set(driverProfileId, totals);
}

async function applyDriverAggregates(
  db: Database,
  driverRideCounts: Map<string, number>,
  driverRatingTotals: Map<string, { sum: number; count: number }>,
): Promise<void> {
  for (const [driverId, rideCount] of driverRideCounts.entries()) {
    const totals = driverRatingTotals.get(driverId);
    const averageRating = totals ? (totals.sum / totals.count).toFixed(2) : null;

    await db
      .update(schema.driverProfiles)
      .set({
        totalRides: rideCount,
        ...(averageRating ? { averageRating } : {}),
        updatedAt: sql`now()`,
      })
      .where(sql`${schema.driverProfiles.id} = ${driverId}`);
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
