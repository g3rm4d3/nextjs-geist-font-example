import { describe, expect, it } from 'vitest';
import {
  computeCandidateCost,
  DEFAULT_SCORING_WEIGHTS,
  MatchingError,
  rankCandidates,
} from './scorer';
import type { MatchingCandidate, ScoringWeights } from './types';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function candidate(overrides: Partial<MatchingCandidate> = {}): MatchingCandidate {
  return {
    driverId: 'drv_1',
    distanceMeters: 1000,
    etaSeconds: 120,
    availableSinceMs: NOW,
    ...overrides,
  };
}

describe('computeCandidateCost', () => {
  it('computes an exact cost from the default weights', () => {
    const cost = computeCandidateCost(
      candidate({ distanceMeters: 1000, etaSeconds: 120, availableSinceMs: NOW }),
      NOW,
    );
    // 1*120 + 0.02*1000 - 0.5*0 = 140
    expect(cost).toBe(140);
  });

  it('a lower ETA produces a lower cost, all else equal', () => {
    const near = computeCandidateCost(candidate({ etaSeconds: 60 }), NOW);
    const far = computeCandidateCost(candidate({ etaSeconds: 600 }), NOW);
    expect(near).toBeLessThan(far);
  });

  it('a shorter distance produces a lower cost, all else equal', () => {
    const near = computeCandidateCost(candidate({ distanceMeters: 500 }), NOW);
    const far = computeCandidateCost(candidate({ distanceMeters: 8000 }), NOW);
    expect(near).toBeLessThan(far);
  });

  it('a longer wait time produces a lower cost (rewards idle drivers)', () => {
    const justWentOnline = computeCandidateCost(candidate({ availableSinceMs: NOW }), NOW);
    const waitedTenMinutes = computeCandidateCost(
      candidate({ availableSinceMs: NOW - 10 * 60 * 1000 }),
      NOW,
    );
    expect(waitedTenMinutes).toBeLessThan(justWentOnline);
  });

  it('a long enough wait can outweigh a modest ETA disadvantage', () => {
    const closeButJustOnline = computeCandidateCost(
      candidate({ etaSeconds: 60, availableSinceMs: NOW }),
      NOW,
    );
    const fartherButWaitedLong = computeCandidateCost(
      candidate({ etaSeconds: 120, availableSinceMs: NOW - 20 * 60 * 1000 }),
      NOW,
    );
    expect(fartherButWaitedLong).toBeLessThan(closeButJustOnline);
  });

  it('accepts all-zero inputs as valid (a driver right at pickup, just went online)', () => {
    const cost = computeCandidateCost(
      candidate({ distanceMeters: 0, etaSeconds: 0, availableSinceMs: NOW }),
      NOW,
    );
    expect(cost).toBe(0);
  });

  it('clamps a future availableSinceMs (clock skew) to zero wait rather than a negative one', () => {
    const cost = computeCandidateCost(candidate({ availableSinceMs: NOW + 60_000 }), NOW);
    const zeroWaitCost = computeCandidateCost(candidate({ availableSinceMs: NOW }), NOW);
    expect(cost).toBe(zeroWaitCost);
  });

  it.each([
    ['negative distance', { distanceMeters: -1 }],
    ['negative eta', { etaSeconds: -1 }],
    ['non-finite distance', { distanceMeters: Infinity }],
    ['non-finite eta', { etaSeconds: NaN }],
    ['non-finite availableSinceMs', { availableSinceMs: NaN }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(() => computeCandidateCost(candidate(overrides), NOW)).toThrow(MatchingError);
  });

  it('rejects a non-finite nowMs', () => {
    expect(() => computeCandidateCost(candidate(), NaN)).toThrow(MatchingError);
  });

  it.each(['etaWeightPerSecond', 'distanceWeightPerMeter', 'waitTimeWeightPerSecond'] as const)(
    'rejects a negative %s weight',
    (key) => {
      const weights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, [key]: -1 };
      expect(() => computeCandidateCost(candidate(), NOW, weights)).toThrow(MatchingError);
    },
  );

  it('a zero weight neutralizes that factor entirely', () => {
    const weights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, distanceWeightPerMeter: 0 };
    const close = computeCandidateCost(candidate({ distanceMeters: 100 }), NOW, weights);
    const far = computeCandidateCost(candidate({ distanceMeters: 100_000 }), NOW, weights);
    expect(close).toBe(far);
  });
});

describe('rankCandidates', () => {
  it('sorts ascending by cost (best candidate first)', () => {
    const candidates = [
      candidate({ driverId: 'far', etaSeconds: 600 }),
      candidate({ driverId: 'near', etaSeconds: 60 }),
      candidate({ driverId: 'medium', etaSeconds: 300 }),
    ];

    const ranked = rankCandidates(candidates, NOW);

    expect(ranked.map((c) => c.driverId)).toEqual(['near', 'medium', 'far']);
  });

  it('does not mutate the input array', () => {
    const candidates = [candidate({ driverId: 'b', etaSeconds: 200 }), candidate({ driverId: 'a', etaSeconds: 100 })];
    const original = [...candidates];

    rankCandidates(candidates, NOW);

    expect(candidates).toEqual(original);
  });

  it('returns an empty array for no candidates', () => {
    expect(rankCandidates([], NOW)).toEqual([]);
  });

  it('respects custom weights over the defaults', () => {
    const candidates = [
      candidate({ driverId: 'closer-but-newer', distanceMeters: 200, availableSinceMs: NOW }),
      candidate({
        driverId: 'farther-but-waited',
        distanceMeters: 5000,
        availableSinceMs: NOW - 30 * 60 * 1000,
      }),
    ];

    // A weighting that cares only about wait time should flip the
    // default (distance-sensitive) ordering.
    const waitOnlyWeights: ScoringWeights = {
      etaWeightPerSecond: 0,
      distanceWeightPerMeter: 0,
      waitTimeWeightPerSecond: 1,
    };

    const ranked = rankCandidates(candidates, NOW, waitOnlyWeights);
    expect(ranked[0]!.driverId).toBe('farther-but-waited');
  });
});

describe('DEFAULT_SCORING_WEIGHTS', () => {
  it('is entirely non-negative and finite', () => {
    for (const value of Object.values(DEFAULT_SCORING_WEIGHTS)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
