import { schema } from '@rideshare/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';

export type RideRow = typeof schema.rides.$inferSelect;
type RideStatusValue = RideRow['status'];
type RideEventActorType = typeof schema.rideEvents.$inferInsert.actorType;

/** Mirrors rides_one_active_per_passenger_key's WHERE clause exactly —
 * keep the two in sync if the ride status enum ever changes. Exported
 * for the admin "active rides" listing (Phase 10), which needs the same
 * non-terminal set at the whole-table level rather than scoped to one
 * passenger/driver. */
export const ACTIVE_RIDE_STATUSES = [
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

/** Mirrors findActiveRideForPassenger, by driver instead — Phase 10
 * uses this to find which ride (if any) a location ping's route sample
 * should be attributed to. A driver has at most one active ride by
 * construction (Phase 8 only ever assigns one at a time). */
export async function findActiveRideForDriver(driverId: string): Promise<RideRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.driverId, driverId), inArray(schema.rides.status, ACTIVE_RIDE_STATUSES)))
    .limit(1);
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

/** Only the columns Phase 9's lifecycle transitions ever set alongside a
 * status change — everything else about a ride is set once, at creation
 * (Phase 7) or acceptance (Phase 8), and never touched again here. */
export type RideLifecycleExtraFields = Partial<
  Pick<
    RideRow,
    | 'matchedAt'
    | 'startedAt'
    | 'completedAt'
    | 'actualDistanceMeters'
    | 'actualDurationSeconds'
    | 'finalFareCents'
    | 'cancelledAt'
    | 'cancelledBy'
    | 'cancellationReason'
  >
>;

export interface AdvanceRideStatusInput {
  rideId: string;
  /** The single exact status this ride must currently be in — not a
   * list. Callers that allow several possible starting states (e.g.
   * cancellation) read the ride first to find out which one actually
   * applies, then pass that specific value here; the conditional UPDATE
   * below is what makes the transition atomic regardless, the same
   * "unlocked read for a friendly message, conditional write for the
   * actual guarantee" pattern Phase 8's handleAccept established. */
  fromStatus: RideStatusValue;
  toStatus: RideStatusValue;
  /** If set, the ride must also currently belong to this driver — a
   * driver operating on a ride that isn't theirs affects zero rows here,
   * same as a wrong `fromStatus` would. */
  driverId?: string;
  extraFields?: RideLifecycleExtraFields;
  actorType: RideEventActorType;
  actorUserId: string | null;
  eventMetadata?: Record<string, unknown>;
  /** If set, also flips this driver back from BUSY to ONLINE in the
   * same transaction — completing or cancelling a ride is what frees a
   * driver up for their next match (the counterpart to Phase 8's
   * BUSY-on-accept). Conditional on the driver still being BUSY, so it
   * never clobbers a driver who (somehow) already went OFFLINE. */
  releaseDriverId?: string;
}

/**
 * The one place every Phase 9 status change goes through: a conditional
 * `UPDATE ... WHERE id = ? AND status = ? [AND driver_id = ?]`, an
 * `INSERT` into the immutable `ride_events` log, and an optional driver
 * release — atomically, in one transaction, so a ride can never end up
 * with a status change that has no matching event (or vice versa), and a
 * completed/cancelled ride can never leave its driver stuck BUSY forever.
 * Returns `undefined` (not a thrown error) when the conditional UPDATE
 * matches nothing — the caller decides what that means (not found, wrong
 * owner, or a race lost since its own pre-read).
 */
export async function advanceRideStatus(
  input: AdvanceRideStatusInput,
): Promise<RideRow | undefined> {
  return db.transaction(async (tx) => {
    const conditions = [
      eq(schema.rides.id, input.rideId),
      eq(schema.rides.status, input.fromStatus),
    ];
    if (input.driverId) conditions.push(eq(schema.rides.driverId, input.driverId));

    const [updated] = await tx
      .update(schema.rides)
      .set({ status: input.toStatus, updatedAt: new Date(), ...input.extraFields })
      .where(and(...conditions))
      .returning();

    if (!updated) return undefined;

    await tx.insert(schema.rideEvents).values({
      rideId: input.rideId,
      previousStatus: input.fromStatus,
      newStatus: input.toStatus,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      metadata: input.eventMetadata ?? null,
    });

    if (input.releaseDriverId) {
      await tx
        .update(schema.driverProfiles)
        .set({ availabilityStatus: 'ONLINE', updatedAt: new Date() })
        .where(
          and(
            eq(schema.driverProfiles.id, input.releaseDriverId),
            eq(schema.driverProfiles.availabilityStatus, 'BUSY'),
          ),
        );
    }

    return updated;
  });
}

export interface ActiveRideAdminRow {
  id: string;
  status: RideStatusValue;
  driverId: string | null;
  passengerFirstName: string;
  passengerLastName: string;
  driverFirstName: string | null;
  driverLastName: string | null;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  requestedAt: Date;
}

/**
 * Section 10: "Admin: show active rides." Every non-terminal ride
 * (`ACTIVE_RIDE_STATUSES`), newest-first, with just enough passenger/
 * driver identity to label a row — not a vehicle (a driver's active
 * vehicle is a separate, optional lookup the caller does per-row only
 * for rows that actually have a driver assigned, avoiding a more complex
 * multi-table join for a query that never returns more than a handful of
 * rows at Stage 1's scale).
 */
export async function listActiveRides(): Promise<ActiveRideAdminRow[]> {
  return db
    .select({
      id: schema.rides.id,
      status: schema.rides.status,
      driverId: schema.rides.driverId,
      passengerFirstName: schema.passengerProfiles.firstName,
      passengerLastName: schema.passengerProfiles.lastName,
      driverFirstName: schema.driverProfiles.firstName,
      driverLastName: schema.driverProfiles.lastName,
      pickupAddress: schema.rides.pickupAddress,
      pickupLat: schema.rides.pickupLat,
      pickupLng: schema.rides.pickupLng,
      destinationAddress: schema.rides.destinationAddress,
      destinationLat: schema.rides.destinationLat,
      destinationLng: schema.rides.destinationLng,
      requestedAt: schema.rides.requestedAt,
    })
    .from(schema.rides)
    .innerJoin(schema.passengerProfiles, eq(schema.rides.passengerId, schema.passengerProfiles.id))
    .leftJoin(schema.driverProfiles, eq(schema.rides.driverId, schema.driverProfiles.id))
    .where(inArray(schema.rides.status, ACTIVE_RIDE_STATUSES))
    .orderBy(desc(schema.rides.requestedAt));
}
