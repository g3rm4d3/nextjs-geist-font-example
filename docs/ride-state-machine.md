# Ride State Machine — Phase 24

## Scope

This is the canonical reference for `rides.status`'s eleven states and
every legal transition between them — one of the docs required for
Stage 1 Final Validation. The full design rationale (why the
transition primitive is a single conditional `UPDATE`, why ownership
and role checks live where they do, the atomicity guarantees under
concurrent requests) lives in `docs/ride-lifecycle.md` (Phase 9); this
doc is the state diagram and transition table on their own, kept
separate so "what are the states and how do they connect" doesn't
require reading the full Phase 9 narrative.

## States

```
REQUESTED
    │  matching finds ≥1 eligible driver, or none (stays here — see docs/matching.md)
    ▼
SEARCHING_DRIVER
    │  a driver accepts an offer
    ▼
DRIVER_ASSIGNED
    │  POST /drivers/me/rides/:id/en-route
    ▼
DRIVER_EN_ROUTE
    │  POST /drivers/me/rides/:id/arrived
    ▼
DRIVER_ARRIVED
    │  POST /drivers/me/rides/:id/picked-up
    ▼
PASSENGER_ONBOARD
    │  POST /drivers/me/rides/:id/start
    ▼
IN_PROGRESS
    │  POST /drivers/me/rides/:id/complete
    ▼
COMPLETED  (terminal)

Cancellation — legal from REQUESTED, SEARCHING_DRIVER, DRIVER_ASSIGNED,
DRIVER_EN_ROUTE, or DRIVER_ARRIVED only (never once a passenger is
physically in the vehicle):

  CANCELLED_BY_PASSENGER  (terminal) — POST /rides/:id/cancel
  CANCELLED_BY_DRIVER     (terminal) — POST /drivers/me/rides/:id/cancel
  CANCELLED_BY_SYSTEM     (terminal) — no live trigger yet; see Known limitations
```

Eleven states total, four of them terminal (`COMPLETED` and the three
`CANCELLED_BY_*` values) — a ride's `status` column never changes again
once it reaches one of those four.

## The forward chain

| From | To | Endpoint | Side effect |
|---|---|---|---|
| `REQUESTED` | `SEARCHING_DRIVER` | — (automatic, `rideService.requestRide`) | Matching starts. |
| `SEARCHING_DRIVER` | `DRIVER_ASSIGNED` | `POST /drivers/me/offer/:id/accept` | Driver flipped to `BUSY`; every other open offer for the ride expired. |
| `DRIVER_ASSIGNED` | `DRIVER_EN_ROUTE` | `POST /drivers/me/rides/:id/en-route` | — |
| `DRIVER_EN_ROUTE` | `DRIVER_ARRIVED` | `POST /drivers/me/rides/:id/arrived` | — |
| `DRIVER_ARRIVED` | `PASSENGER_ONBOARD` | `POST /drivers/me/rides/:id/picked-up` | — |
| `PASSENGER_ONBOARD` | `IN_PROGRESS` | `POST /drivers/me/rides/:id/start` | Sets `started_at`; `ride_location_samples` recording begins. |
| `IN_PROGRESS` | `COMPLETED` | `POST /drivers/me/rides/:id/complete` | Sets `completed_at`/`actual_distance_meters`/`actual_duration_seconds`/`final_fare_cents`; releases driver to `ONLINE`; auto-charges the TEST payment; records driver earnings + platform revenue. |

Every transition above is driver-initiated and strictly sequential —
skipping a stage (e.g. `DRIVER_ASSIGNED` straight to `arrived`) is
rejected with `409 Conflict`, enforced by the conditional `UPDATE ...
WHERE status = <fromStatus>` every transition goes through (see
`docs/ride-lifecycle.md`'s "transition primitive" section) — impossible
by construction, not by a special-cased guard.

## Enforcement guarantees

- **A driver can only operate a ride assigned to them.** Every
  driver-side transition's `WHERE` clause includes `driver_id = <this
  driver>`.
- **A passenger can only cancel their own ride**, and only through
  `POST /rides/:id/cancel` — no other passenger-initiated status
  change exists.
- **Acceptance is atomic.** `SEARCHING_DRIVER → DRIVER_ASSIGNED` is a
  single conditional `UPDATE`; two drivers racing to accept the same
  ride can only ever produce one winner — see `docs/matching.md`.
- **The financial fields on `COMPLETED` are server-computed, never
  client-supplied** — `final_fare_cents` comes from `packages/pricing`
  applied to the actual measured trip, not anything the client sends.

## Known limitations

- **`CANCELLED_BY_SYSTEM` has no automatic trigger** — it's a real,
  producible code path (`cancelRideBySystem`), but nothing currently
  calls it on a timeout or stuck-ride condition; a `SEARCHING_DRIVER`
  ride that exhausts every eligible candidate stays there indefinitely.
- **No customer-facing "scheduled ride" or "multi-stop" state** —
  explicitly out of Stage 1 scope (see the repo root's own "future
  features — do not implement yet" list).

See `docs/ride-lifecycle.md` for the full narrative (the transition
primitive's implementation, ownership/role enforcement in depth,
cancellation fee computation, and the test suite that proves every
guarantee above).
