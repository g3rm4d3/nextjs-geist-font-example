import { describe, expect, it } from 'vitest';
import { MatchingError } from './scorer';
import { DEFAULT_SEARCH_RADII_METERS, selectCandidatesWithinExpandingRadius } from './radiusSearch';
import type { MatchingCandidate } from './types';

function candidate(driverId: string, distanceMeters: number): MatchingCandidate {
  return { driverId, distanceMeters, etaSeconds: distanceMeters / 10, availableSinceMs: 0 };
}

describe('DEFAULT_SEARCH_RADII_METERS', () => {
  it('matches the spec\'s example progression: 2 / 5 / 10 / 15 km', () => {
    expect(DEFAULT_SEARCH_RADII_METERS).toEqual([2000, 5000, 10000, 15000]);
  });
});

describe('selectCandidatesWithinExpandingRadius', () => {
  it('returns the innermost tier when a candidate is already within it', () => {
    const candidates = [candidate('a', 1500), candidate('b', 12000)];

    const result = selectCandidatesWithinExpandingRadius(candidates);

    expect(result).not.toBeNull();
    expect(result!.radiusMeters).toBe(2000);
    expect(result!.candidates.map((c) => c.driverId)).toEqual(['a']);
  });

  it('expands to the next tier when the innermost one is empty', () => {
    const candidates = [candidate('a', 4000)];

    const result = selectCandidatesWithinExpandingRadius(candidates);

    expect(result!.radiusMeters).toBe(5000);
    expect(result!.candidates.map((c) => c.driverId)).toEqual(['a']);
  });

  it('expands all the way to the widest tier if that is the only one with candidates', () => {
    const candidates = [candidate('a', 14000)];

    const result = selectCandidatesWithinExpandingRadius(candidates);

    expect(result!.radiusMeters).toBe(15000);
  });

  it('returns null when no candidate is within even the widest tier', () => {
    const candidates = [candidate('a', 20000)];

    expect(selectCandidatesWithinExpandingRadius(candidates)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(selectCandidatesWithinExpandingRadius([])).toBeNull();
  });

  it('includes a candidate exactly at a tier boundary (<=, not <)', () => {
    const candidates = [candidate('a', 2000)];

    const result = selectCandidatesWithinExpandingRadius(candidates);

    expect(result!.radiusMeters).toBe(2000);
    expect(result!.candidates).toHaveLength(1);
  });

  it('includes every candidate within the chosen tier, not just the closest one', () => {
    const candidates = [candidate('a', 1000), candidate('b', 1800), candidate('c', 9000)];

    const result = selectCandidatesWithinExpandingRadius(candidates);

    expect(result!.radiusMeters).toBe(2000);
    expect(result!.candidates.map((c) => c.driverId).sort()).toEqual(['a', 'b']);
  });

  it('accepts a custom radii list', () => {
    const candidates = [candidate('a', 3000)];

    const result = selectCandidatesWithinExpandingRadius(candidates, [1000, 4000]);

    expect(result!.radiusMeters).toBe(4000);
  });

  it('sorts an out-of-order custom radii list before searching', () => {
    const candidates = [candidate('a', 4000)];

    const result = selectCandidatesWithinExpandingRadius(candidates, [10000, 1000, 5000]);

    // Should stop at 5000 (the smallest tier containing the candidate),
    // not 10000 (the first element as given).
    expect(result!.radiusMeters).toBe(5000);
  });

  it('rejects an empty radii list', () => {
    expect(() => selectCandidatesWithinExpandingRadius([candidate('a', 100)], [])).toThrow(
      MatchingError,
    );
  });

  it('rejects a non-positive radius', () => {
    expect(() =>
      selectCandidatesWithinExpandingRadius([candidate('a', 100)], [2000, 0]),
    ).toThrow(MatchingError);
    expect(() =>
      selectCandidatesWithinExpandingRadius([candidate('a', 100)], [2000, -500]),
    ).toThrow(MatchingError);
  });
});
