import type { MatchingCandidate, ScoringWeights } from './types';

export class MatchingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchingError';
  }
}

/**
 * Section 8: "Rank candidates initially using: estimated pickup ETA,
 * distance, availability." Deliberately weights, not a lexicographic
 * sort (ETA first, then distance, then...) — a weighted-sum cost lets
 * a driver who's been waiting substantially longer outrank one with a
 * marginally shorter ETA, which a strict "ETA always wins" ordering
 * could never express. Lower cost = more preferred candidate.
 *
 * ETA and distance are currently near-perfectly correlated (the MOCK
 * RouteProvider derives duration linearly from distance — see
 * docs/maps.md), so weighting both separately doesn't change ordering
 * today. They're kept as independent terms anyway because a real
 * routing provider (traffic, one-way streets) would make them diverge,
 * and the point of this shape is to already be ready for that.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  etaWeightPerSecond: 1,
  distanceWeightPerMeter: 0.02,
  waitTimeWeightPerSecond: 0.5,
};

function validateCandidate(candidate: MatchingCandidate): void {
  if (!Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters < 0) {
    throw new MatchingError('distanceMeters must be a finite number >= 0');
  }
  if (!Number.isFinite(candidate.etaSeconds) || candidate.etaSeconds < 0) {
    throw new MatchingError('etaSeconds must be a finite number >= 0');
  }
  if (!Number.isFinite(candidate.availableSinceMs)) {
    throw new MatchingError('availableSinceMs must be a finite number');
  }
}

function validateWeights(weights: ScoringWeights): void {
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new MatchingError(`${name} must be a finite number >= 0`);
    }
  }
}

/**
 * Lower is better. `nowMs` is passed in (not read from Date.now()
 * internally) so this stays a pure, deterministic function — callers
 * decide what "now" means, tests don't need fake timers.
 */
export function computeCandidateCost(
  candidate: MatchingCandidate,
  nowMs: number,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  validateCandidate(candidate);
  validateWeights(weights);
  if (!Number.isFinite(nowMs)) {
    throw new MatchingError('nowMs must be a finite number');
  }

  const waitSeconds = Math.max(0, (nowMs - candidate.availableSinceMs) / 1000);

  return (
    weights.etaWeightPerSecond * candidate.etaSeconds +
    weights.distanceWeightPerMeter * candidate.distanceMeters -
    weights.waitTimeWeightPerSecond * waitSeconds
  );
}

/** Ascending by cost — candidates[0] is the best (lowest-cost) offer target. */
export function rankCandidates(
  candidates: MatchingCandidate[],
  nowMs: number,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): MatchingCandidate[] {
  return [...candidates].sort(
    (a, b) => computeCandidateCost(a, nowMs, weights) - computeCandidateCost(b, nowMs, weights),
  );
}
