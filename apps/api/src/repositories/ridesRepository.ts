import { schema } from '@rideshare/database';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';

export type RideRow = typeof schema.rides.$inferSelect;

/** Mirrors rides_one_active_per_passenger_key's WHERE clause exactly —
 * keep the two in sync if the ride status enum ever changes. */
const ACTIVE_RIDE_STATUSES = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'PASSENGER_ONBOARD',
  'IN_PROGRESS',
] as const;

export async function findActiveRideForPassenger(
  passengerId: string,
): Promise<RideRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rides)
    .where(
      and(
        eq(schema.rides.passengerId, passengerId),
        inArray(schema.rides.status, ACTIVE_RIDE_STATUSES),
      ),
    )
    .limit(1);
  return row;
}

export async function findRideById(rideId: string): Promise<RideRow | undefined> {
  const [row] = await db.select().from(schema.rides).where(eq(schema.rides.id, rideId)).limit(1);
  return row;
}

export async function findRideByIdempotencyKey(
  passengerId: string,
  idempotencyKey: string,
): Promise<RideRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rides)
    .where(
      and(
        eq(schema.rides.passengerId, passengerId),
        eq(schema.rides.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row;
}

export interface CreateRideInput {
  passengerId: string;
  idempotencyKey: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  estimatedFareCents: number;
}

/**
 * Section 7's "Initial state: REQUESTED -> SEARCHING_DRIVER" as one
 * atomic operation: insert at REQUESTED, log that transition, advance to
 * SEARCHING_DRIVER, log that transition too — all in one transaction, so
 * a mid-sequence failure never leaves a ride stuck at REQUESTED with no
 * SEARCHING_DRIVER event, or vice versa. The *only* two statuses this
 * phase (or its ride_events history) ever produces; no matching happens
 * here (Phase 8).
 */
export async function createRideAndAdvanceToSearching(
  input: CreateRideInput,
  actorUserId: string,
): Promise<RideRow> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.rides)
      .values({
        passengerId: input.passengerId,
        idempotencyKey: input.idempotencyKey,
        status: 'REQUESTED',
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        destinationAddress: input.destinationAddress,
        destinationLat: input.destinationLat,
        destinationLng: input.destinationLng,
        estimatedDistanceMeters: input.estimatedDistanceMeters,
        estimatedDurationSeconds: input.estimatedDurationSeconds,
        estimatedFareCents: input.estimatedFareCents,
      })
      .returning();
    if (!inserted) throw new Error('Failed to insert ride');

    await tx.insert(schema.rideEvents).values({
      rideId: inserted.id,
      previousStatus: null,
      newStatus: 'REQUESTED',
      actorType: 'PASSENGER',
      actorUserId,
      latitude: input.pickupLat,
      longitude: input.pickupLng,
    });

    const [searching] = await tx
      .update(schema.rides)
      .set({ status: 'SEARCHING_DRIVER', updatedAt: new Date() })
      .where(eq(schema.rides.id, inserted.id))
      .returning();
    if (!searching) throw new Error('Failed to advance ride to SEARCHING_DRIVER');

    await tx.insert(schema.rideEvents).values({
      rideId: inserted.id,
      previousStatus: 'REQUESTED',
      newStatus: 'SEARCHING_DRIVER',
      actorType: 'SYSTEM',
      actorUserId: null,
    });

    return searching;
  });
}
