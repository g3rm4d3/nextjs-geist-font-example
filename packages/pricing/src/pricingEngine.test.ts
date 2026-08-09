import { describe, expect, it } from 'vitest';
import { calculateFare, PricingError } from './pricingEngine';
import type { PricingConfig } from './types';

const STANDARD_CONFIG: PricingConfig = {
  baseFareCents: 250,
  perMileRateCents: 150,
  perMinuteRateCents: 25,
  minimumFareCents: 500,
  bookingFeeCents: 200,
  platformCommissionPercentage: 20,
};

const METERS_PER_MILE = 1609.344;

describe('calculateFare — basic itemization', () => {
  it('computes each line item correctly for a 5 mile, 10 minute ride', () => {
    const result = calculateFare(
      { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
      STANDARD_CONFIG,
    );

    expect(result.baseFareCents).toBe(250);
    expect(result.distanceFareCents).toBe(750); // 150 * 5 miles
    expect(result.timeFareCents).toBe(250); // 25 * 10 minutes
    expect(result.bookingFeeCents).toBe(200);
    expect(result.subtotalCents).toBe(1450);
    expect(result.minimumFareApplied).toBe(false);
    expect(result.totalCents).toBe(1450);
  });
});

describe('calculateFare — minimum fare', () => {
  it('floors the total up to minimumFareCents when the subtotal is lower', () => {
    const result = calculateFare(
      { distanceMeters: 100, durationSeconds: 60 }, // ~0.06 mi, 1 min — a very short ride
      STANDARD_CONFIG,
    );

    // subtotal = 250 (base) + 9 (distance) + 25 (time) + 200 (booking) = 484
    expect(result.subtotalCents).toBe(484);
    expect(result.minimumFareApplied).toBe(true);
    expect(result.totalCents).toBe(500);
  });

  it('does not apply the minimum when the subtotal already exceeds it', () => {
    const result = calculateFare(
      { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
      STANDARD_CONFIG,
    );

    expect(result.minimumFareApplied).toBe(false);
    expect(result.totalCents).toBe(result.subtotalCents);
  });

  it('applies the minimum exactly when the subtotal equals it', () => {
    const config: PricingConfig = { ...STANDARD_CONFIG, minimumFareCents: 1450 };
    const result = calculateFare(
      { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
      config,
    );

    expect(result.subtotalCents).toBe(1450);
    expect(result.totalCents).toBe(1450);
    // Equal, not "below" the minimum — flag should reflect no flooring occurred.
    expect(result.minimumFareApplied).toBe(false);
  });
});

describe('calculateFare — rounding', () => {
  it('rounds fractional cents to the nearest whole cent', () => {
    const config: PricingConfig = {
      baseFareCents: 0,
      perMileRateCents: 3,
      perMinuteRateCents: 3,
      minimumFareCents: 0,
      bookingFeeCents: 0,
      platformCommissionPercentage: 0,
    };

    // Exactly 0.5 miles and 0.5 minutes: 3 * 0.5 = 1.5 cents each,
    // which Math.round takes to 2 (rounds half up).
    const result = calculateFare(
      { distanceMeters: 0.5 * METERS_PER_MILE, durationSeconds: 30 },
      config,
    );

    expect(result.distanceFareCents).toBe(2);
    expect(result.timeFareCents).toBe(2);
    expect(result.totalCents).toBe(4);
  });

  it('never produces a fractional cent anywhere in the breakdown', () => {
    // An intentionally "ugly" distance/duration that won't divide evenly.
    const result = calculateFare(
      { distanceMeters: 12345.678, durationSeconds: 987 },
      STANDARD_CONFIG,
    );

    for (const value of Object.values(result)) {
      if (typeof value === 'number') {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });
});

describe('calculateFare — zero values', () => {
  it('accepts zero distance and duration as a valid (not invalid) edge case', () => {
    const result = calculateFare({ distanceMeters: 0, durationSeconds: 0 }, STANDARD_CONFIG);

    expect(result.distanceFareCents).toBe(0);
    expect(result.timeFareCents).toBe(0);
    // subtotal = 250 + 0 + 0 + 200 = 450, below the 500 minimum.
    expect(result.subtotalCents).toBe(450);
    expect(result.minimumFareApplied).toBe(true);
    expect(result.totalCents).toBe(500);
  });

  it('accepts a zero platformCommissionPercentage', () => {
    const config: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage: 0 };
    const result = calculateFare({ distanceMeters: 0, durationSeconds: 0 }, config);

    expect(result.platformCommissionCents).toBe(0);
    expect(result.driverEarningsCents).toBe(result.totalCents);
  });

  it('accepts all-zero fee config, producing a zero total', () => {
    const config: PricingConfig = {
      baseFareCents: 0,
      perMileRateCents: 0,
      perMinuteRateCents: 0,
      minimumFareCents: 0,
      bookingFeeCents: 0,
      platformCommissionPercentage: 0,
    };
    const result = calculateFare({ distanceMeters: 0, durationSeconds: 0 }, config);

    expect(result.totalCents).toBe(0);
    expect(result.minimumFareApplied).toBe(false);
  });
});

describe('calculateFare — invalid values', () => {
  it('rejects a negative distance', () => {
    expect(() => calculateFare({ distanceMeters: -1, durationSeconds: 60 }, STANDARD_CONFIG)).toThrow(
      PricingError,
    );
  });

  it('rejects a negative duration', () => {
    expect(() => calculateFare({ distanceMeters: 100, durationSeconds: -1 }, STANDARD_CONFIG)).toThrow(
      PricingError,
    );
  });

  it('rejects a non-finite distance', () => {
    expect(() =>
      calculateFare({ distanceMeters: Number.NaN, durationSeconds: 60 }, STANDARD_CONFIG),
    ).toThrow(PricingError);
    expect(() =>
      calculateFare({ distanceMeters: Number.POSITIVE_INFINITY, durationSeconds: 60 }, STANDARD_CONFIG),
    ).toThrow(PricingError);
  });

  it('rejects a negative config field', () => {
    const config: PricingConfig = { ...STANDARD_CONFIG, baseFareCents: -1 };
    expect(() => calculateFare({ distanceMeters: 100, durationSeconds: 60 }, config)).toThrow(
      PricingError,
    );
  });

  it('rejects a commission percentage outside [0, 100]', () => {
    const tooLow: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage: -5 };
    const tooHigh: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage: 105 };

    expect(() => calculateFare({ distanceMeters: 100, durationSeconds: 60 }, tooLow)).toThrow(
      PricingError,
    );
    expect(() => calculateFare({ distanceMeters: 100, durationSeconds: 60 }, tooHigh)).toThrow(
      PricingError,
    );
  });
});

describe('calculateFare — long rides', () => {
  it('handles a 500 mile, 5 hour ride without overflow or precision loss', () => {
    const result = calculateFare(
      { distanceMeters: 500 * METERS_PER_MILE, durationSeconds: 5 * 60 * 60 },
      STANDARD_CONFIG,
    );

    expect(result.distanceFareCents).toBe(75_000); // 150 * 500
    expect(result.timeFareCents).toBe(7_500); // 25 * 300
    expect(result.subtotalCents).toBe(82_950);
    expect(result.totalCents).toBe(82_950);
    expect(result.minimumFareApplied).toBe(false);
    expect(Number.isInteger(result.totalCents)).toBe(true);
  });
});

describe('calculateFare — commission calculation', () => {
  it.each([0, 10, 17.5, 20, 33.33, 50, 100])(
    'commission + driver earnings always sum back to the total (%s%%)',
    (platformCommissionPercentage) => {
      const config: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage };
      const result = calculateFare(
        { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
        config,
      );

      expect(result.platformCommissionCents + result.driverEarningsCents).toBe(result.totalCents);
    },
  );

  it('gives 100% commission to the platform when the rate is 100', () => {
    const config: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage: 100 };
    const result = calculateFare(
      { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
      config,
    );

    expect(result.platformCommissionCents).toBe(result.totalCents);
    expect(result.driverEarningsCents).toBe(0);
  });

  it('gives 100% of the fare to the driver when the rate is 0', () => {
    const config: PricingConfig = { ...STANDARD_CONFIG, platformCommissionPercentage: 0 };
    const result = calculateFare(
      { distanceMeters: 5 * METERS_PER_MILE, durationSeconds: 10 * 60 },
      config,
    );

    expect(result.platformCommissionCents).toBe(0);
    expect(result.driverEarningsCents).toBe(result.totalCents);
  });
});
