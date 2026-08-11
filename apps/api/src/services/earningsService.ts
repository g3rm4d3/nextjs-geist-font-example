import type { FareBreakdown } from '@rideshare/pricing';
import type { DriverEarningsHistoryEntry, DriverEarningsSummary, PlatformRevenueSummary } from '@rideshare/types';
import {
  createDriverEarnings,
  findDriverEarningsByRideId,
  listDriverEarningsHistory,
  sumDriverEarningsSince,
  sumPlatformEarnings,
} from '../repositories/earningsRepository';
import { findLatestPaymentRecordForRide } from '../repositories/paymentsRepository';
import { findRideById } from '../repositories/ridesRepository';
import { findDriverProfileByUserId } from '../repositories/usersRepository';

const HISTORY_LIMIT = 50;

function startOfUtcDay(reference: Date): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
}

/** ISO-style week (Monday start), in UTC — not the driver's local
 * timezone (see docs/financial-ledger.md's known limitations). */
function startOfUtcWeek(reference: Date): Date {
  const dayStart = startOfUtcDay(reference);
  const isoDayIndex = (dayStart.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
  dayStart.setUTCDate(dayStart.getUTCDate() - isoDayIndex);
  return dayStart;
}

function startOfUtcMonth(reference: Date): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
}

/**
 * Section 12: "For completed test rides record: gross fare, platform
 * commission, driver gross earnings, adjustments, payment status,
 * payout status placeholder." Called from
 * rideLifecycleService.completeRide right alongside
 * paymentService.chargeRideFare, using the exact same `FareBreakdown`
 * that call already computed (`fare.totalCents`/`platformCommissionCents`/
 * `driverEarningsCents`) — no second pricing calculation, no risk of the
 * ledger and the ride ever disagreeing about the fare. `adjustments` and
 * `payout_status` both default per the schema (0 / PENDING) — Stage 1
 * has no adjustment- or payout-issuing flow, so those columns exist as
 * real, honest placeholders rather than being populated here.
 *
 * Idempotent: `driver_earnings_ride_id_key` (a unique index) is the
 * actual guarantee; this checks first so a double-trigger is a cheap,
 * friendly no-op instead of a caught constraint violation — same
 * "read-first, write-once" shape as paymentService.chargeRideFare.
 */
export async function recordEarningsForCompletedRide(
  rideId: string,
  driverId: string,
  fare: FareBreakdown,
): Promise<void> {
  const existing = await findDriverEarningsByRideId(rideId);
  if (existing) return;

  await createDriverEarnings({
    rideId,
    driverId,
    grossFareCents: fare.totalCents,
    platformCommissionCents: fare.platformCommissionCents,
    driverGrossEarningsCents: fare.driverEarningsCents,
  });
}

/** "Driver sees: Today / Week / Month" — three independently-computed
 * windows (not a rolling chart), each summed fresh from driver_earnings. */
export async function getDriverEarningsSummary(userId: string): Promise<DriverEarningsSummary> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');

  const now = new Date();
  const [today, week, month] = await Promise.all([
    sumDriverEarningsSince(profile.id, startOfUtcDay(now)),
    sumDriverEarningsSince(profile.id, startOfUtcWeek(now)),
    sumDriverEarningsSince(profile.id, startOfUtcMonth(now)),
  ]);

  return { today, week, month };
}

/** "Driver sees: ... Ride history." Ride and payment details are joined
 * per row (not in the repository query) — the same "fine at Stage 1's
 * scale" trade-off routes/admin.ts's listActiveRides already made for
 * per-row vehicle lookups. */
export async function getDriverEarningsHistory(userId: string): Promise<DriverEarningsHistoryEntry[]> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');

  const rows = await listDriverEarningsHistory(profile.id, HISTORY_LIMIT);

  return Promise.all(
    rows.map(async (row) => {
      const [ride, payment] = await Promise.all([
        findRideById(row.rideId),
        findLatestPaymentRecordForRide(row.rideId),
      ]);

      return {
        id: row.id,
        rideId: row.rideId,
        completedAt: (ride?.completedAt ?? row.createdAt).toISOString(),
        pickupLabel: ride?.pickupAddress ?? 'Unknown pickup',
        destinationLabel: ride?.destinationAddress ?? 'Unknown destination',
        grossFareCents: row.grossFareCents,
        platformCommissionCents: row.platformCommissionCents,
        driverGrossEarningsCents: row.driverGrossEarningsCents,
        adjustmentsCents: row.adjustmentsCents,
        payoutStatus: row.payoutStatus,
        paymentStatus: payment?.status ?? null,
      };
    }),
  );
}

/** "Admin sees platform test revenue" — the platform-wide equivalent of
 * getDriverEarningsSummary, plus an all-time total. Never real money
 * (section 1/11) — this sums driver_earnings rows generated entirely by
 * Stripe TEST MODE-charged fictional rides. */
export async function getPlatformRevenueSummary(): Promise<PlatformRevenueSummary> {
  const now = new Date();
  const [today, week, month, allTime] = await Promise.all([
    sumPlatformEarnings(startOfUtcDay(now)),
    sumPlatformEarnings(startOfUtcWeek(now)),
    sumPlatformEarnings(startOfUtcMonth(now)),
    sumPlatformEarnings(),
  ]);

  return { today, week, month, allTime };
}
