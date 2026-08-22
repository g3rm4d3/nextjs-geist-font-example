# Matching — Phase 24

## Scope

The canonical, short reference for how a ride finds a driver — one of
the docs required for Stage 1 Final Validation. `docs/matching-engine.md`
(Phase 8) is the full design narrative (the scoring formula's
rationale, the deadlock that was found and fixed under load, the
cross-ride race condition fixed in Phase 21); this doc is the "what
happens, in order" summary.

## The flow

```
Ride reaches SEARCHING_DRIVER (rideService.requestRide)
  │
  ▼
Candidate search: eligible drivers within an expanding radius
  (2km → 5km → 10km → 15km — packages/matching's DEFAULT_SEARCH_RADII_METERS),
  stopping at the first tier with ≥1 candidate
  │
  ▼
Rank candidates by a single weighted cost (ETA + distance + how long
  the driver has been waiting — packages/matching's scorer.ts)
  │
  ▼
Offer the top-ranked candidate — GET /drivers/me/offer (driver side)
  │
  ├─ ACCEPT  → ride → DRIVER_ASSIGNED (atomic — exactly one winner if
  │             two drivers race for the same offer)
  ├─ DECLINE → advance to the next-ranked candidate
  └─ TIMEOUT → same as DECLINE, driven by a background sweep
               (MATCHING_OFFER_TIMEOUT_SECONDS, default 15s), not the driver
```

Zero eligible candidates at any point is a valid, non-error outcome —
the ride simply stays `SEARCHING_DRIVER` with no open offer (see
`docs/ride-state-machine.md`'s Known Limitations for what that means
today: no automatic retry when a new driver later comes online).

## Eligibility (all of the following)

- `driver_profiles.onboarding_status = 'APPROVED'`
- `driver_profiles.availability_status = 'ONLINE'`
- A location ping within the last 2 minutes (`STALE_THRESHOLD_MS`)
- Not already holding an open offer for *any* ride (enforced at the
  database level by a unique constraint — see "Concurrency" below)
- Not already tried (any status) for *this specific* ride, so one
  matching attempt never re-offers the same candidate twice

## Concurrency

Two distinct races, both closed:

1. **Two drivers accepting the same offer** — the accept transition is
   one atomic conditional `UPDATE` on the `rides` row; only the first
   to commit wins, the other gets `409`. Proven at 50-driver scale.
2. **Two different, unrelated rides' independent matching attempts
   both trying to offer the same driver at once** — closed by a real
   database-level partial `UNIQUE` index
   (`ride_requests_one_open_offer_per_driver_key`, Phase 21) scoped to
   `driver_id` alone, not `(ride_id, driver_id)`. The losing side isn't
   an error — `matchingService` simply tries the next-ranked candidate,
   since the full ranking was already computed.

## Known limitations

See `docs/matching-engine.md`'s own Known Limitations for the complete
list (no push notifications — polling only; a stuck `SEARCHING_DRIVER`
ride has no automatic retry; search radii aren't independently
env-configurable).
