# Matching Engine — Phase 8

## Scope

`MatchingService` finds and offers a ride to a driver, independently of
any UI: candidate search → rank → offer → response timer →
ACCEPT/DECLINE/TIMEOUT → next candidate if necessary, repeated until
either a driver accepts or every eligible candidate has been tried.
Acceptance is atomic — two drivers racing to accept the same ride can
only ever produce one winner, guaranteed by the database, not by
application-level luck. Matching is triggered automatically the moment a
ride reaches `SEARCHING_DRIVER` (Phase 7 deliberately deferred this: "Do
NOT automatically match driver until Phase 8").

## Package layout: `packages/matching`

A pure, dependency-free engine package — no I/O, no database, no HTTP —
following the same pattern as `packages/pricing`'s `PricingEngine`:

- **`scorer.ts`** — `computeCandidateCost(candidate, nowMs, weights?)`
  returns a single number where *lower is better*, combining three
  weighted terms: ETA, distance, and how long the driver has been
  available (longer wait → lower cost, i.e. a mild fairness nudge toward
  idle drivers). `rankCandidates` sorts a candidate list ascending by
  this cost.
- **`radiusSearch.ts`** — `selectCandidatesWithinExpandingRadius` tries
  `DEFAULT_SEARCH_RADII_METERS` (`[2000, 5000, 10000, 15000]` — the
  spec's example progression) in ascending order and returns the first
  tier with at least one candidate, or `null` if none of them do.

**Why a single weighted cost instead of a lexicographic sort** (spec:
"architecture must allow future scoring factors without rewrite"): a
lexicographic "first by ETA, ties broken by distance" sort has no room to
add a fourth factor without deciding where it slots into the tie-break
order — and that decision keeps changing as factors are added. A
weighted-sum cost adds a factor by adding a term; `scorer.test.ts` proves
this isn't just theoretical — a long-waiting driver can outrank one with
a modest ETA advantage (`waitedTenMinutes` beats `justWentOnline`),
which a naive "ETA first" sort could never produce.

**A currently-redundant-looking design choice, kept anyway**: the MOCK
`RouteProvider` (`@rideshare/maps`, Phase 3) derives duration linearly
from distance, so today ETA and distance are near-perfectly correlated —
weighting both separately has little practical effect *right now*. They
stay separate because a real routing provider (traffic, road network)
would make them diverge, and the architecture goal is "add a factor
without a rewrite," not "only have factors that currently matter."

`packages/matching`: 34/34 tests passing, `npm run build:packages` chain
updated to include it (a build-order mistake made twice in earlier
phases and documented in `docs/architecture.md` — not repeated here).

## Eligibility

Section 8's list — `APPROVED`, `ONLINE`, recent valid location — plus one
requirement this phase's own design adds, implemented in
`matchingRepository.findEligibleDrivers`:

| Requirement | How it's checked |
|---|---|
| **APPROVED** | `driver_profiles.onboarding_status = 'APPROVED'`. Technically already implied by the next row — the database's `driver_profiles_availability_requires_approval_chk` CHECK constraint means a driver can never be `ONLINE` without also being `APPROVED` — but checked explicitly anyway as defense-in-depth, not because it's reachable to violate today. |
| **ONLINE** | `driver_profiles.availability_status = 'ONLINE'`. There is no separate "AVAILABLE" enum value (`driverAvailabilityStatusEnum` only has `OFFLINE` / `ONLINE` / `BUSY`) — `ONLINE` *is* what the spec's "AVAILABLE" wording means here. |
| **recent valid location** | An inner join against `driver_locations` with `recorded_at >=` a staleness cutoff, reusing Phase 6's exact `STALE_THRESHOLD_MS` (2 minutes) constant from `locationService.ts` rather than defining a second one that could drift out of sync. A driver with no location row at all is excluded by the inner join itself. |
| **not already mid-offer** | Excludes any driver currently holding an open (`OFFERED`) `ride_requests` row for *any* ride — a driver can only ever be considering one offer at a time. |
| **not already tried for this ride** | Callers pass every `driverId` already present in `ride_requests` for this specific ride (any status), so a single matching attempt for a ride never offers the same candidate twice. |

## Offer flow

One offer at a time, per the spec's own wording — "offer driver" is
singular, "next candidate *if necessary*" implies sequence, not a
broadcast to every eligible driver at once:

```
Ride Request → candidate search → offer driver → response timer
  → ACCEPT  → ride DRIVER_ASSIGNED, driver BUSY, every other OFFERED row for the ride expired
  → DECLINE → advance to next candidate (excluding every driver already tried)
  → TIMEOUT → same as DECLINE, but driven by the background sweep, not the driver
```

`matchingService`'s `findAndOfferNextCandidate` is the one function that
implements "candidate search → offer driver," and it's deliberately the
same operation whether it's the *first* attempt for a ride
(`startMatching`, called once by `rideService.requestRide` right after a
ride reaches `SEARCHING_DRIVER`) or a *subsequent* one
(`advanceToNextCandidate`, called after a decline or a sweep-driven
timeout) — because it always excludes every previously-tried driver, "start"
and "advance" have no different state to track between them. Finding
zero eligible candidates is a valid, non-error outcome at any point: the
ride simply stays `SEARCHING_DRIVER` with no open offer.

`rideService.requestRide` calls `startMatching` inside a `try`/`catch` —
a genuine matching failure (not "no candidates found," which isn't a
failure at all) logs and does not fail the ride request itself; the ride
still exists at `SEARCHING_DRIVER` and can be picked up by whatever
happens next.

## Acceptance atomicity

> "Acceptance MUST be atomic. Two drivers attempting to accept
> simultaneously must result in exactly ONE winner."

`matchingService.handleAccept` runs one transaction whose *first* write
is a conditional `UPDATE rides ... WHERE status = 'SEARCHING_DRIVER'`.
Postgres's row-level lock on that single row is what actually decides the
winner: only the first transaction to commit ever sees
`SEARCHING_DRIVER`; every other concurrent transaction's same `UPDATE`
finds `DRIVER_ASSIGNED` already and affects zero rows. Only *after*
winning that lock does the transaction touch `ride_requests` — mark the
winning offer `ACCEPTED`, expire every other still-`OFFERED` row for the
ride, flip the driver to `BUSY`, and log a `ride_events` row. A driver who
loses the race has their own `ride_requests` row explicitly marked
`EXPIRED` — not reverted to `OFFERED`, not left `ACCEPTED` — so its final
state honestly reads "responded, but too late."

**The lock-`rides`-first ordering is load-bearing, not stylistic.** An
earlier version of this transaction wrote to the driver's own
`ride_requests` row *before* racing for the `rides` row. Under real
concurrent load that produced an actual Postgres deadlock: a losing
transaction could be holding a lock on its own (losing) `ride_requests`
row while blocked waiting on `rides`, and the winner's later "expire
every other `OFFERED` row for this ride" step would then try to lock that
exact row too — a genuine circular wait, not a hypothetical one. It was
caught by this phase's own 50-driver concurrency test, not by review.
Locking `rides` first means a losing transaction never holds any
`ride_requests` lock while it waits on anything else, so no cycle can
form. See the code comment on `handleAccept` in
`apps/api/src/services/matchingService.ts` for the step-by-step.

## Background sweep

`sweepExpiredOffers` (called on a `setInterval`, `MATCHING_SWEEP_INTERVAL_MS`,
default 5s) finds every `OFFERED` row whose `expires_at`
(`MATCHING_OFFER_TIMEOUT_SECONDS`, default 15s) has passed, atomically
expires each one (`expireOfferAtomic`, conditional on still being
`OFFERED` *and* actually expired — so a response arriving in the same
instant never loses to it), and advances every successfully-expired
ride to its next candidate. This timer lives in `src/index.ts` (actual
process startup) and deliberately never in `createApp()`, which is also
what every test in this repo builds directly via `supertest` — a ticking
background interval during test runs would make them non-deterministic.
Tests that need to exercise a timeout call `sweepExpiredOffers()` directly
after back-dating a row's `expires_at`, rather than waiting on a real
clock.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /drivers/me/offer` | The driver's current open offer, or `null` — normal "nothing right now," not an error. |
| `POST /drivers/me/offer/:id/accept` | `:id` is the `ride_requests` id (`RideOffer.id`). `409` if the offer is gone, already responded to, or the ride was already assigned to someone else. |
| `POST /drivers/me/offer/:id/decline` | Always advances matching to the next candidate. |

All three sit behind `requireAuth` + `requireRole('DRIVER')` and a
per-driver (not per-IP) rate limiter, `driverOfferLimiter` — same
reasoning as Phase 6's `locationPingLimiter`: this is a driver's own
operational polling cadence, not an anti-abuse dimension IP-keying would
serve well.

## Client: driver-app

`DriverHomeMapScreen` polls `GET /drivers/me/offer` every 4 seconds while
`ONLINE` and navigates to `IncomingRequestScreen` the moment one exists —
the closest honest substitute for push notifications, which don't exist
in this stage. `IncomingRequestScreen` independently re-fetches the offer
on mount (one source of truth, reachable from more than just that poll),
shows the ride's pickup/destination/distance/fare, and runs a local
countdown from `expiresAt` — a visual cue only; the real timer is
enforced server-side by the sweep, and Accept/Decline both go through the
real atomic/conditional endpoints. Accepting navigates to
`PickupNavigationScreen` (still Phase 10's stub); declining returns to
the map.

## Tests

- `packages/matching/src/scorer.test.ts`, `radiusSearch.test.ts` — pure
  unit tests: cost formula correctness, ranking order and non-mutation,
  clock-skew clamping, invalid-input rejection, radius-tier selection
  including exact-boundary inclusion. 34/34.
- `apps/api/src/routes/driverOffers.test.ts` — integration tests against
  real Postgres:
  - Closest-eligible-driver offer selection; zero-candidate and
    stale-location exclusion; the "already mid-offer elsewhere" exclusion.
  - `GET /drivers/me/offer` (empty and populated).
  - Accept (happy path, wrong-driver rejection, nonexistent-offer
    rejection) and decline (advances to next candidate; search-exhausted
    leaves the ride `SEARCHING_DRIVER`).
  - `sweepExpiredOffers` expiring a back-dated offer and advancing.
  - **Concurrency**: two drivers racing to accept the same ride —
    exactly one `200`, one `409`, exactly one `ACCEPTED` row, every other
    row `EXPIRED`. Then the same guarantee at 50-driver scale (the
    spec's own "test with 50 simulated drivers"), which is what surfaced
    and proved the fix for the deadlock described above.
- Full repo verification after this phase: lint, typecheck, and a clean
  `rm -rf packages/*/dist && npm run build` all pass; 238 tests passing
  repo-wide (100 of them in `apps/api`).

## Known limitations

- **No push notifications.** Offer delivery to a driver is polling
  (`DriverHomeMapScreen`, every 4s), not a push. Acceptable for Stage 1
  technical validation; a real product would need push infrastructure
  this environment has no way to provision.
- **A ride that exhausts every eligible candidate does not automatically
  retry.** If matching runs out of candidates (every eligible driver
  tried and declined/timed out, or none were ever eligible), the ride
  stays `SEARCHING_DRIVER` with no open offer and nothing re-triggers a
  search later (e.g. when a new driver comes online). A passenger-facing
  cancellation path for a stuck `SEARCHING_DRIVER` ride is Phase 9's job,
  not this one's.
- **`driver_profiles.updated_at` is a proxy for "available since,"** not
  a dedicated column — `driverService.setAvailability` (Phase 5) bumps it
  on every `ONLINE`/`OFFLINE` transition, which is close enough for the
  wait-time scoring term but not exact (e.g. an unrelated profile update
  would also bump it, in principle, though nothing in this codebase does
  that today). Documented trade-off, not a bug: adding a dedicated column
  for one scoring input didn't seem worth a schema change at this stage.
- **Search radii are not independently env-configurable** beyond the
  package's own `DEFAULT_SEARCH_RADII_METERS` — "configurable" is
  satisfied architecturally (`selectCandidatesWithinExpandingRadius`
  takes the radii list as a parameter, not a hardcoded constant), not via
  an environment variable, unlike the offer timeout/sweep interval which
  are (`MATCHING_OFFER_TIMEOUT_SECONDS`, `MATCHING_SWEEP_INTERVAL_MS`).
- **No passenger-facing "driver found" update yet.** The passenger app's
  `SearchingDriverScreen` (Phase 7) still just shows the ride sitting at
  whatever status it's in — it doesn't poll or otherwise learn that a
  driver accepted. Surfacing ride-state changes to the passenger is
  Phase 9's concern (ride lifecycle), not this phase's.
