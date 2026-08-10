import { MatchingError } from './scorer';
import type { MatchingCandidate } from './types';

/**
 * Section 8: "Search radii must be configurable. Example progression:
 * 2 km, 5 km, 10 km, 15 km." Meters, not km, to match every other
 * distance in this codebase (RoutePreview.distanceMeters, the
 * driver_locations schema, etc.).
 */
export const DEFAULT_SEARCH_RADII_METERS = [2000, 5000, 10000, 15000];

export interface RadiusSearchResult {
  radiusMeters: number;
  candidates: MatchingCandidate[];
}

/**
 * Expanding-radius search: tries each radius tier in ascending order and
 * returns the first one with at least one candidate inside it — never a
 * fixed single radius, and never "search everything at once and hope
 * the ranking sorts it out" (a driver 14km away should only ever be
 * offered a ride once every closer tier has come up empty).
 *
 * Returns null if no radius tier (up to the widest configured one)
 * contains any candidate — "no eligible driver was found," not an error.
 *
 * Pure and synchronous: `candidatesWithDistance` must already have every
 * candidate's distanceMeters computed (apps/api's matchingService does
 * that via the RouteProvider before calling this) — this function only
 * decides which tier to search and never computes a distance itself.
 */
export function selectCandidatesWithinExpandingRadius(
  candidatesWithDistance: MatchingCandidate[],
  radiiMeters: number[] = DEFAULT_SEARCH_RADII_METERS,
): RadiusSearchResult | null {
  if (radiiMeters.length === 0) {
    throw new MatchingError('radiiMeters must contain at least one radius');
  }
  for (const radiusMeters of radiiMeters) {
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      throw new MatchingError('each radius must be a finite number > 0');
    }
  }

  const sortedRadii = [...radiiMeters].sort((a, b) => a - b);

  for (const radiusMeters of sortedRadii) {
    const candidates = candidatesWithDistance.filter((c) => c.distanceMeters <= radiusMeters);
    if (candidates.length > 0) {
      return { radiusMeters, candidates };
    }
  }

  return null;
}
