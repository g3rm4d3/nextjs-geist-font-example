import type { FareBreakdown, FareEstimateInput, PricingConfig } from './types';

const METERS_PER_MILE = 1609.344;
const SECONDS_PER_MINUTE = 60;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/**
 * Centralized, server-only fare calculation (section 4/Phase 4). Every
 * monetary value in and out is an integer number of cents; the only
 * non-integer arithmetic happens internally (converting meters→miles and
 * seconds→minutes) and is rounded back to whole cents immediately with
 * Math.round before anything is returned or added.
 *
 * No dynamic/surge pricing, ride categories, or geographic zones yet —
 * explicitly out of scope for this phase (section 4's "potential future
 * configuration").
 */
export function calculateFare(input: FareEstimateInput, config: PricingConfig): FareBreakdown {
  validateInput(input);
  validateConfig(config);

  const distanceMiles = input.distanceMeters / METERS_PER_MILE;
  const durationMinutes = input.durationSeconds / SECONDS_PER_MINUTE;

  const distanceFareCents = Math.round(config.perMileRateCents * distanceMiles);
  const timeFareCents = Math.round(config.perMinuteRateCents * durationMinutes);

  const subtotalCents =
    config.baseFareCents + distanceFareCents + timeFareCents + config.bookingFeeCents;

  const totalCents = Math.max(subtotalCents, config.minimumFareCents);
  const minimumFareApplied = totalCents > subtotalCents;

  const platformCommissionCents = Math.round(
    totalCents * (config.platformCommissionPercentage / 100),
  );
  // Derived, not independently rounded: guarantees commission + driver
  // earnings always sum back to exactly totalCents, matching the
  // driver_earnings table's balance CHECK constraint (packages/database).
  const driverEarningsCents = totalCents - platformCommissionCents;

  return {
    baseFareCents: config.baseFareCents,
    distanceFareCents,
    timeFareCents,
    bookingFeeCents: config.bookingFeeCents,
    subtotalCents,
    minimumFareCents: config.minimumFareCents,
    minimumFareApplied,
    totalCents,
    platformCommissionCents,
    driverEarningsCents,
  };
}

function validateInput(input: FareEstimateInput): void {
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) {
    throw new PricingError('distanceMeters must be a finite number >= 0');
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) {
    throw new PricingError('durationSeconds must be a finite number >= 0');
  }
}

function validateConfig(config: PricingConfig): void {
  const nonNegativeCentsFields: Array<[string, number]> = [
    ['baseFareCents', config.baseFareCents],
    ['perMileRateCents', config.perMileRateCents],
    ['perMinuteRateCents', config.perMinuteRateCents],
    ['minimumFareCents', config.minimumFareCents],
    ['bookingFeeCents', config.bookingFeeCents],
  ];

  for (const [name, value] of nonNegativeCentsFields) {
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingError(`${name} must be a finite number >= 0`);
    }
  }

  if (
    !Number.isFinite(config.platformCommissionPercentage) ||
    config.platformCommissionPercentage < 0 ||
    config.platformCommissionPercentage > 100
  ) {
    throw new PricingError('platformCommissionPercentage must be a finite number between 0 and 100');
  }
}
