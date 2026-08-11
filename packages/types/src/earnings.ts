/**
 * Financial ledger API contract (Phase 12), shared by apps/api (producer)
 * and driver-app/admin-app (consumers). Mirrors
 * @rideshare/database's driver_earnings row and payout_status enum by
 * hand rather than importing them — this package stays dependency-free
 * on purpose (see docs/architecture.md).
 */
export type PayoutStatus = 'PENDING' | 'PAID';

export interface EarningsPeriodTotals {
  rideCount: number;
  grossFareCents: number;
  platformCommissionCents: number;
  driverGrossEarningsCents: number;
  adjustmentsCents: number;
}

/** "Driver sees: Today / Week / Month" — three independently-summed
 * windows, not a rolling chart; each is its own complete totals object. */
export interface DriverEarningsSummary {
  today: EarningsPeriodTotals;
  week: EarningsPeriodTotals;
  month: EarningsPeriodTotals;
}

/** One row of "Driver sees: ... Ride history" — a completed, earning-
 * generating ride, joined with its payment's current status. */
export interface DriverEarningsHistoryEntry {
  id: string;
  rideId: string;
  completedAt: string;
  pickupLabel: string;
  destinationLabel: string;
  grossFareCents: number;
  platformCommissionCents: number;
  driverGrossEarningsCents: number;
  adjustmentsCents: number;
  payoutStatus: PayoutStatus;
  /** Null only if a payment record genuinely doesn't exist yet for this
   * ride (a rare race — see docs/payments.md's chargeRideFare). */
  paymentStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | null;
}

/** "Admin sees platform test revenue" — the platform-wide equivalent of
 * DriverEarningsSummary, plus an all-time total. */
export interface PlatformRevenueSummary {
  today: EarningsPeriodTotals;
  week: EarningsPeriodTotals;
  month: EarningsPeriodTotals;
  allTime: EarningsPeriodTotals;
}
