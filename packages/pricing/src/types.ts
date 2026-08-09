/**
 * All monetary fields are integer cents (section 10) — never floating
 * point. `platformCommissionPercentage` is the one non-currency field: a
 * percentage in [0, 100].
 */
export interface PricingConfig {
  baseFareCents: number;
  perMileRateCents: number;
  perMinuteRateCents: number;
  minimumFareCents: number;
  bookingFeeCents: number;
  platformCommissionPercentage: number;
}

export interface FareEstimateInput {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Itemized breakdown, not just a total — Phase 4 requires "return
 * itemized estimate", and later phases (Phase 12's earnings ledger) need
 * the commission/driver split, not just the customer-facing total.
 */
export interface FareBreakdown {
  baseFareCents: number;
  distanceFareCents: number;
  timeFareCents: number;
  bookingFeeCents: number;
  /** Sum of the four line items above, before the minimum-fare floor. */
  subtotalCents: number;
  minimumFareCents: number;
  /** True when subtotalCents was below minimumFareCents and got floored up to it. */
  minimumFareApplied: boolean;
  /** What the passenger is actually charged: max(subtotalCents, minimumFareCents). */
  totalCents: number;
  platformCommissionCents: number;
  /** Always totalCents - platformCommissionCents exactly (never independently rounded), so the two always sum back to totalCents. */
  driverEarningsCents: number;
}
