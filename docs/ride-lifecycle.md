# Ride Lifecycle — Phase 9

## Scope

"Implement strict lifecycle" — the six states after a driver is matched
(`DRIVER_ASSIGNED → DRIVER_EN_ROUTE → DRIVER_ARRIVED → PASSENGER_ONBOARD
→ IN_PROGRESS → COMPLETED`), plus cancellation pathways, all validated
server-side, with every transition producing its own immutable
`ride_events` row. Three specific guard rails the spec calls out by
name — a driver cannot complete a ride that never started, a passenger
cannot arbitrarily modify state, a driver cannot operate another
driver's ride — are all enforced structurally by how the transition
primitive itself works, not by separate bolted-on checks. No schema
migration was needed: `rides.matched_at` / `started_at` / `completed_at`
/ `cancelled_at` / `cancelled_by` / `cancellation_reason` and the full
`rideStatusEnum` (including all three `CANCELLED_BY_*` values) were
already defined in Phase 1's schema, anticipating this phase.

## The transition primitive

Every status change in this phase — forward or cancellation — goes
through one function: `ridesRepository.advanceRideStatus`. It takes a
single exact `fromStatus` (never a range) and, in one transaction:

1. `UPDATE rides SET status = ? ... WHERE id = ? AND status = fromStatus
   [AND driver_id = ?]` — a plain conditional compare-and-swap, the same
   pattern Phase 7 (idempotency) and Phase 8 (offer acceptance) already
   established in this codebase. Affects at most one row, and only if
   the ride is still exactly where the caller expects.
2. If that matched, `INSERT INTO ride_events (previous_status, new_status,
   actor_type, actor_user_id, ...)` — so a status change and its audit
   row are atomically inseparable: neither can happen without the other,
   in either direction.
3. Optionally, `UPDATE driver_profiles SET availability_status =
   'ONLINE' WHERE id = ? AND availability_status = 'BUSY'` — releasing a
   driver back to available on completion or cancellation, the
   counterpart to Phase 8's BUSY-on-accept. Conditional on still being
   `BUSY` so it can never clobber a driver who (somehow) already went
   `OFFLINE`.

`rideLifecycleService` is the only caller, and every one of its exported
functions is a thin wrapper: read the ride first (unlocked, for a
precise error message), then call `advanceRideStatus` with one specific
`fromStatus → toStatus` pair. The read is not what enforces anything —
same "unlocked read for a friendly message, conditional write for the
actual guarantee" split Phase 8's `handleAccept` established — a race
between the read and the write just means the conditional UPDATE matches
nothing, and the caller gets a `409 Conflict` instead of a stale success.

## The forward chain

| From | To | Endpoint | Side effects |
|---|---|---|---|
| `DRIVER_ASSIGNED` | `DRIVER_EN_ROUTE` | `POST /drivers/me/rides/:id/en-route` | — |
| `DRIVER_EN_ROUTE` | `DRIVER_ARRIVED` | `POST /drivers/me/rides/:id/arrived` | — |
| `DRIVER_ARRIVED` | `PASSENGER_ONBOARD` | `POST /drivers/me/rides/:id/picked-up` | — |
| `PASSENGER_ONBOARD` | `IN_PROGRESS` | `POST /drivers/me/rides/:id/start` | sets `started_at` |
| `IN_PROGRESS` | `COMPLETED` | `POST /drivers/me/rides/:id/complete` | sets `completed_at`, `actual_distance_meters`, `actual_duration_seconds`, `final_fare_cents`; releases the driver to `ONLINE` |

Every one of these is driver-only (`requireRole('DRIVER')`), and every
one is a *fixed* single-status transition — there is no endpoint that
takes an arbitrary target status as input. That fixed-pair design is
what makes "driver cannot complete a ride that never started" true by
construction rather than by a special-cased check: `COMPLETED` is only
ever reached with `fromStatus = 'IN_PROGRESS'`, and `IN_PROGRESS` is only
ever reached via `startTrip`, the one place `started_at` is ever set.
`completeRide` additionally double-checks `ride.startedAt` is set before
even attempting the transition — belt-and-suspenders on the same
invariant, not a second rule.

**Final fare.** Computed the same server-authoritative way as the
estimate (section 3, `pricingService.getFareForActualTrip`) but from the
trip's *actual* duration and distance rather than the pre-trip route
preview. With no live route tracking in Stage 1 (see docs/maps.md),
"actual" is a mix: `actual_duration_seconds` is genuinely real elapsed
wall-clock time between `startedAt` and `completedAt`; `actual_distance_meters`
reuses the pre-trip route estimate. Documented limitation below, not
silently glossed over.

## Ownership: "driver cannot operate another driver's ride"

Every driver-facing lifecycle function reads the ride and checks
`ride.driverId === callerDriverId` *before* attempting anything, and a
mismatch — or the ride simply not existing — both produce the identical
`404 Not Found`, never a `403 Forbidden`. A driver hitting an endpoint
for a ride that isn't theirs cannot distinguish "no such ride" from
"someone else's ride"; the second case would itself leak that such a
ride exists. The same not-found-not-forbidden treatment applies to
`GET /drivers/me/rides/:id` and to driver-side cancellation.

## "Passenger cannot arbitrarily modify state"

There is exactly one passenger-facing state-changing action in this
entire phase: `POST /rides/:id/cancel`, and it is restricted to a fixed
set of pre-onboard statuses (below). Every one of the five forward
endpoints is `requireRole('DRIVER')` — a passenger token gets a plain
`403` from the role gate, before any ride-specific logic even runs.
There is no endpoint anywhere that accepts a `status` field from a
client and applies it; the only way any ride's status ever changes is
through one of the fixed, named transitions in this document.

## Cancellation

Legal from `REQUESTED`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`,
`DRIVER_EN_ROUTE`, or `DRIVER_ARRIVED` — i.e. any time *before* the
passenger is actually in the vehicle. Once `PASSENGER_ONBOARD` or
`IN_PROGRESS`, cancellation is no longer offered to either side; a trip
already underway is a different (unimplemented, Stage-1-out-of-scope)
"incident" concern, not a plain cancel.

- `POST /rides/:id/cancel` (passenger) → `CANCELLED_BY_PASSENGER`.
- `POST /drivers/me/rides/:id/cancel` (driver) → `CANCELLED_BY_DRIVER`.
- `cancelRideBySystem` (service function only, no route) →
  `CANCELLED_BY_SYSTEM` — see known limitations.

All three share one function (`rideLifecycleService`'s internal
`cancelRide`), which reads the ride, verifies ownership (for
passenger/driver), checks the current status is in the cancellable set,
and calls `advanceRideStatus` with `cancelledAt`/`cancelledBy`/
`cancellationReason` set and (if a driver was assigned) `releaseDriverId`
set — so cancelling an assigned ride frees that driver back to `ONLINE`
in the same transaction as the cancellation itself.

## RideRow -> Ride mapping: one shared module

`rideService`, `matchingService`, and `rideLifecycleService` each return
`Ride` objects, and `rideService` calls `matchingService.startMatching`
— so any one of those three services owning the mapping function would
make at least one of the others import back from it, a circular module
dependency (this is exactly what Phase 8's `matchingService` worked
around by duplicating the mapping locally, before this phase). Phase 9
extracts it once, to `apps/api/src/lib/rideMapper.ts` — a small leaf
module none of the three services import from each other through — and
all three now share it instead of maintaining three copies that could
drift out of sync as `Ride`'s shape grows (as it just did, by four
fields, in this same phase).

## Tests

`apps/api/src/routes/rideLifecycle.test.ts` — 14 integration tests
against real Postgres:

- The full happy-path lifecycle to `COMPLETED`, asserting the exact
  `ride_events` sequence (8 rows, `REQUESTED` through `COMPLETED`) and
  that the driver is released back to `ONLINE`.
- Skipping a stage (`DRIVER_ASSIGNED` straight to `arrived`) → `409`.
- Driver cannot complete an unstarted ride (stops at `PASSENGER_ONBOARD`,
  calls `complete`) → `409`, `completedAt` still null.
- A second driver cannot operate, cancel, or read a ride that isn't
  theirs → `404` in every case.
- A passenger token hitting every one of the five forward endpoints →
  `403` from every one.
- `GET /rides/:id` / `GET /drivers/me/rides/:id` — the assigned passenger
  and driver can read; an unrelated passenger gets `404`.
- Cancellation: before a match, after a match (driver released), rejected
  once onboard, rejected once completed, driver-initiated cancellation
  (also releases the driver), an unrelated passenger cannot cancel.
- `cancelRideBySystem` called directly (no HTTP route exists) proves
  `CANCELLED_BY_SYSTEM` is a real, producible code path.

Full repo verification after this phase: lint, typecheck, and a clean
`rm -rf packages/*/dist && npm run build` all pass; 114 tests passing in
`apps/api` alone (up from 100 before this phase), every other
workspace's suite unaffected.

## Client changes

**driver-app**: `PickupNavigationScreen`, `ArrivalScreen`, `RideScreen`,
`RideCompleteScreen` (all previously honest stubs) are now functional,
wired through a new `ActiveRideContext` (mirrors `DriverProfileContext`
and `apps/passenger-app`'s `RideDraftContext`) that carries the ride
from `IncomingRequestScreen`'s Accept through to completion. Two
deliberate UI simplifications, both documented in the affected screens'
own comments:

- `DRIVER_ASSIGNED → DRIVER_EN_ROUTE` fires automatically on
  `PickupNavigationScreen`'s mount — "accepted" and "started heading to
  pickup" are the same moment for a driver, so there's no separate
  button for it.
- `ArrivalScreen`'s single "Confirm pickup & start trip" button issues
  two API calls back to back (`picked-up` then `start`) — both distinct
  backend transitions, both separately logged, collapsed into one tap
  because that's genuinely one real-world moment for the driver.

Neither simplification removes a backend state or its `ride_events` row
— they only change how many taps the UI needs.

**passenger-app**: `SearchingDriverScreen` gains a "Cancel ride" button
(`POST /rides/:id/cancel`) — the one piece of this phase squarely in the
passenger app's scope ("implement cancellation pathways"). The screen
still does not poll or otherwise display live ride status beyond what it
already showed in Phase 7 — that's explicitly Phase 10's "realtime ride
experience," not this phase's.

## Known limitations

- **No live route tracking**, so `completeRide`'s `actual_distance_meters`
  reuses the pre-trip route estimate rather than a real GPS-derived
  figure — only `actual_duration_seconds` (real elapsed wall-clock time)
  is genuinely "actual." See docs/maps.md for why: no paid, network-
  dependent routing provider is configured in this environment.
- **`CANCELLED_BY_SYSTEM` has no automatic trigger.** The function
  (`cancelRideBySystem`) is real, exported, and directly tested, but
  nothing in Stage 1 calls it — there is no "no driver found for too
  long" or similar policy wired up. A ride matching exhausts without
  finding a driver (Phase 8's own known limitation) just sits
  `SEARCHING_DRIVER` indefinitely; nothing here changes that.
- **Cancellation has no fee.** `rides.cancellation_reason` is free text,
  stored but not shown to the other party, and there's no
  `cancellationFeeCents` charged anywhere (the pricing config has a
  `cancellationFeeCents` column from Phase 4, unused since — a real
  cancellation-fee policy is out of this phase's scope).
- **The driver-app's two UI simplifications** (above) mean a driver can
  never observe `PASSENGER_ONBOARD` as a distinct, separately-confirmed
  screen state — only via the `ride_events` history, which does still
  record it as its own row.
- **Passenger app still doesn't poll.** `SearchingDriverScreen` shows
  whatever status the ride had when the screen last fetched it (at ride-
  request time) plus, now, the ability to cancel — it does not learn
  about `DRIVER_ASSIGNED`, `DRIVER_ARRIVED`, etc. as they happen. That's
  Phase 10's job.
