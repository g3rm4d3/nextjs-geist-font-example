/**
 * A driver who has already passed eligibility filtering (APPROVED,
 * ONLINE, recent valid location, not already offered elsewhere — see
 * apps/api's matchingRepository) and is being considered for a
 * particular ride request.
 */
export interface MatchingCandidate {
  driverId: string;
  /** Straight-line-derived distance from the driver's last known
   * location to the ride's pickup point, in meters. */
  distanceMeters: number;
  /** Estimated time for this driver to reach pickup, in seconds. */
  etaSeconds: number;
  /** Epoch milliseconds this driver became available — see
   * apps/api's matchingRepository for how this is derived from
   * driver_profiles. Older (further in the past) means they've been
   * idle/waiting longer. */
  availableSinceMs: number;
}

/**
 * Per-factor weights for computeCandidateCost. Each is "cost per unit of
 * the corresponding input" — larger weight means that factor matters
 * more. waitTimeWeightPerSecond is subtracted (more wait time lowers
 * cost, i.e. is preferred) while the others are added.
 *
 * "Architecture must allow future scoring factors without rewrite"
 * (section 8): adding a new ranking input means adding one field here
 * and one weighted term in computeCandidateCost — every existing caller,
 * test, and candidate shape is untouched.
 */
export interface ScoringWeights {
  etaWeightPerSecond: number;
  distanceWeightPerMeter: number;
  waitTimeWeightPerSecond: number;
}
