import { schema } from '@rideshare/database';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type UserRow = typeof schema.users.$inferSelect;
export type PassengerProfileRow = typeof schema.passengerProfiles.$inferSelect;
export type DriverProfileRow = typeof schema.driverProfiles.$inferSelect;

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return user;
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return user;
}

/**
 * Minimal admin listing (Phase 2 scope: proving admin-only authorization
 * works end-to-end). Full filtering/pagination/search is Phase 14's job.
 */
export async function listUsers(limit = 20): Promise<UserRow[]> {
  return db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(limit);
}

export async function findPassengerProfileByUserId(
  userId: string,
): Promise<PassengerProfileRow | undefined> {
  const [profile] = await db
    .select()
    .from(schema.passengerProfiles)
    .where(eq(schema.passengerProfiles.userId, userId))
    .limit(1);
  return profile;
}

export async function findDriverProfileByUserId(
  userId: string,
): Promise<DriverProfileRow | undefined> {
  const [profile] = await db
    .select()
    .from(schema.driverProfiles)
    .where(eq(schema.driverProfiles.userId, userId))
    .limit(1);
  return profile;
}

/** By driver_profiles.id rather than users.id — Phase 10's
 * rideTrackingService only has `ride.driverId` (the profile id) on hand,
 * not the driver's own userId. */
export async function findDriverProfileById(
  driverId: string,
): Promise<DriverProfileRow | undefined> {
  const [profile] = await db
    .select()
    .from(schema.driverProfiles)
    .where(eq(schema.driverProfiles.id, driverId))
    .limit(1);
  return profile;
}

export interface CreatePassengerInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
}

export async function createPassenger(
  input: CreatePassengerInput,
): Promise<{ user: UserRow; profile: PassengerProfileRow }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        phone: input.phone ?? null,
        role: 'PASSENGER',
      })
      .returning();
    if (!user) throw new Error('Failed to insert passenger user');

    const [profile] = await tx
      .insert(schema.passengerProfiles)
      .values({ userId: user.id, firstName: input.firstName, lastName: input.lastName })
      .returning();
    if (!profile) throw new Error('Failed to insert passenger profile');

    return { user, profile };
  });
}

export interface CreateDriverInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
  licenseNumber: string;
  licenseState: string;
}

export async function createDriver(
  input: CreateDriverInput,
): Promise<{ user: UserRow; profile: DriverProfileRow }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        phone: input.phone ?? null,
        role: 'DRIVER',
      })
      .returning();
    if (!user) throw new Error('Failed to insert driver user');

    const [profile] = await tx
      .insert(schema.driverProfiles)
      .values({
        userId: user.id,
        firstName: input.firstName,
        lastName: input.lastName,
        licenseNumber: input.licenseNumber,
        licenseState: input.licenseState,
        // Driver accounts start unapproved — see docs/database.md section 9.
        onboardingStatus: 'DRAFT',
      })
      .returning();
    if (!profile) throw new Error('Failed to insert driver profile');

    return { user, profile };
  });
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await db
    .update(schema.users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}
