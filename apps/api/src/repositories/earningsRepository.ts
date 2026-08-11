import { schema } from '@rideshare/database';
import { and, count, desc, eq, gte, sum } from 'drizzle-orm';
import { db } from '../db/client';

export type DriverEarningsRow = typeof schema.driverEarnings.$inferSelect;

export interface CreateDriverEarningsInput {
  rideId: string;
  driverId: string;
  grossFareCents: number;
  platformCommissionCents: number;
  driverGrossEarningsCents: number;
}

/** One row per completed ride — driver_earnings_ride_id_key (a unique
 * index) is the actual guarantee against double-recording; callers
 * (earningsService.recordEarningsForCompletedRide) check first for a
 * cheap, friendly no-op rather than relying solely on that constraint. */
export async function createDriverEarnings(
  input: CreateDriverEarningsInput,
): Promise<DriverEarningsRow> {
  const [row] = await db.insert(schema.driverEarnings).values(input).returning();
  if (!row) throw new Error('Failed to create driver earnings row');
  return row;
}

export async function findDriverEarningsByRideId(
  rideId: string,
): Promise<DriverEarningsRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.driverEarnings)
    .where(eq(schema.driverEarnings.rideId, rideId))
    .limit(1);
  return row;
}

/** "Ride history" — a driver's own completed, earning-generating rides,
 * most recent first. Ride/payment details are joined per-row in
 * earningsService, not here — same "per-row lookup, fine at Stage 1's
 * scale" trade-off routes/admin.ts's listActiveRides already made. */
export async function listDriverEarningsHistory(
  driverId: string,
  limit: number,
): Promise<DriverEarningsRow[]> {
  return db
    .select()
    .from(schema.driverEarnings)
    .where(eq(schema.driverEarnings.driverId, driverId))
    .orderBy(desc(schema.driverEarnings.createdAt))
    .limit(limit);
}

export interface EarningsTotals {
  rideCount: number;
  grossFareCents: number;
  platformCommissionCents: number;
  driverGrossEarningsCents: number;
  adjustmentsCents: number;
}

/** SUM()/COUNT() on integer columns come back from Postgres as strings
 * (avoiding precision loss the pg driver can't otherwise guarantee) —
 * safe to convert to Number here since these are cents totals, nowhere
 * near JS's safe-integer ceiling at Stage 1's scale. A NULL sum (zero
 * matching rows) is a real zero, not a missing value. */
function toTotals(row: {
  rideCount: number;
  grossFareCents: string | null;
  platformCommissionCents: string | null;
  driverGrossEarningsCents: string | null;
  adjustmentsCents: string | null;
}): EarningsTotals {
  return {
    rideCount: row.rideCount,
    grossFareCents: Number(row.grossFareCents ?? 0),
    platformCommissionCents: Number(row.platformCommissionCents ?? 0),
    driverGrossEarningsCents: Number(row.driverGrossEarningsCents ?? 0),
    adjustmentsCents: Number(row.adjustmentsCents ?? 0),
  };
}

const EARNINGS_TOTALS_SELECTION = {
  rideCount: count(),
  grossFareCents: sum(schema.driverEarnings.grossFareCents),
  platformCommissionCents: sum(schema.driverEarnings.platformCommissionCents),
  driverGrossEarningsCents: sum(schema.driverEarnings.driverGrossEarningsCents),
  adjustmentsCents: sum(schema.driverEarnings.adjustmentsCents),
};

/** One driver's totals for rides completed at or after `since` — the
 * source for each of DriverEarningsSummary's Today/Week/Month windows. */
export async function sumDriverEarningsSince(driverId: string, since: Date): Promise<EarningsTotals> {
  const [row] = await db
    .select(EARNINGS_TOTALS_SELECTION)
    .from(schema.driverEarnings)
    .where(and(eq(schema.driverEarnings.driverId, driverId), gte(schema.driverEarnings.createdAt, since)));
  if (!row) throw new Error('Aggregate query unexpectedly returned no rows');
  return toTotals(row);
}

/** Same shape, platform-wide (no driverId filter) — "Admin sees
 * platform test revenue". `since` omitted means all-time. */
export async function sumPlatformEarnings(since?: Date): Promise<EarningsTotals> {
  const [row] = await db
    .select(EARNINGS_TOTALS_SELECTION)
    .from(schema.driverEarnings)
    .where(since ? gte(schema.driverEarnings.createdAt, since) : undefined);
  if (!row) throw new Error('Aggregate query unexpectedly returned no rows');
  return toTotals(row);
}
