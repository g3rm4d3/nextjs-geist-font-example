# Ride Request Service — Phase 7

## Scope

"Passenger can submit ride request." The backend independently validates
pickup, destination, route, estimate, passenger eligibility, and active
ride status; never accepts an authoritative fare from the client; and
protects against duplicate requests (idempotency, plus a passenger
literally cannot accidentally create two active rides through
double-tapping). The ride's initial lifecycle is `REQUESTED →
SEARCHING_DRIVER` — nothing beyond that. Matching a driver to it is
explicitly out of scope until Phase 8.

## What "independently validates" means for each item

| Spec item | Where it's actually enforced |
|---|---|
| **pickup** / **destination** | `createRideRequestSchema` bounds-checks both coordinates before the request ever reaches `rideService` (400 on failure); the database's own `rides_pickup_lat_range_chk` etc. CHECK constraints are the backstop under that. |
| **route** | Recomputed from scratch via `pricingService.getFareEstimateWithRoute`, which calls the same `RouteProvider` (`@rideshare/maps`, Phase 3) every other server-side route calculation uses. The client's own on-screen route preview (Phase 3) is never trusted as input — there's no route/distance/duration field anywhere in `CreateRideRequest` for a client to supply one. |
| **estimate** | Same call also runs `@rideshare/pricing`'s `calculateFare` (Phase 4) against the freshly computed route and the active pricing config. The stored `estimatedFareCents` is always this server-computed number. |
| **passenger eligibility** | The authenticated user must exist, be `isActive`, and have a `passenger_profiles` row (the last should always be true for a `PASSENGER`-role account; checked defensively rather than assumed). This is what's actually enforceable given what Stage 1 has built so far — a real product's eligibility rules (payment method on file, no fraud flags, etc.) don't exist yet and aren't invented here. |
| **active ride status** | At most one non-terminal ride per passenger — see below. |

**Never accept authoritative fare from client** (section 3): `CreateRideRequest` has no fare field at all — not optional, not present. Even if a client includes one anyway (`estimatedFareCents: 1` in the JSON body), Zod's default "strip unknown keys" behavior on `z.object()` drops it before validation even runs; `rides.test.ts`'s "never uses a client-supplied fare figure" test sends exactly this and confirms the response reflects the real server-computed value instead.

## Idempotency and the one-active-ride invariant

Two related but distinct problems, two distinct mechanisms — both enforced primarily at the database level via unique indexes on `rides` (partial `WHERE`, like several other invariants already in this schema — `pricing_configs_one_active_key`, `vehicles_one_active_per_driver_key`), not just an application-level check-then-insert that a race could slip through:

1. **`rides_passenger_idempotency_key_key`** — `UNIQUE (passenger_id, idempotency_key)`. The client generates one key per *request attempt* (`apps/passenger-app`'s `generateIdempotencyKey()`) and resends it unchanged on every retry of that same attempt. A repeat `POST /rides` with the same key returns the *original* ride (`created: false`, HTTP 200) instead of erroring or duplicating. This is what makes a genuine network retry — the response was lost but the server actually succeeded — safe to resend.

2. **`rides_one_active_per_passenger_key`** — `UNIQUE (passenger_id) WHERE status IN (<the seven non-terminal statuses>)`. At most one row per passenger may be active at a time, full stop — independent of idempotency keys. This is section 7's literal "passenger cannot accidentally create two active rides through double-tapping": even a buggy client that generates a *different* key per tap (defeating idempotency) still can't create a second active ride; the second insert hits this constraint and the passenger gets a clean `409 CONFLICT`.

`rideService.requestRide` checks both proactively (an idempotency-key lookup, then an active-ride lookup) to avoid hitting the database constraints in the common, non-racing case — but the constraints are the actual guarantee. Under a genuine race (two requests arriving close enough together that both pass the proactive checks before either commits), whichever insert the database accepts second fails with a `23505` unique violation; the service catches it, identifies which of the two constraints fired, and either re-fetches the winning row (idempotency-key race) or returns `409` (active-ride race) — never a raw database error reaching the client.

`rides.test.ts` verifies both race paths directly by firing two real concurrent `POST /rides` calls with `Promise.all`:
- **Same idempotency key, concurrent** → both calls succeed, both return the identical ride ID, and exactly one row exists in the database.
- **Different idempotency keys, concurrent** (the "buggy client" scenario) → exactly one call succeeds (`201`), the other gets `409`, and exactly one row exists.

Both were run repeatedly (4+ times back to back) with no flakiness.

## The REQUESTED → SEARCHING_DRIVER transition

`ridesRepository.createRideAndAdvanceToSearching` does the whole sequence — insert at `REQUESTED`, log that as a `ride_events` row, update to `SEARCHING_DRIVER`, log that transition too — inside one database transaction. A client only ever observes the final state (`SEARCHING_DRIVER`) in the response, but the history in `ride_events` accurately records both steps, with the first attributed to the passenger (`actorType: 'PASSENGER'`) and the second to the system (`actorType: 'SYSTEM'`, since nothing the passenger did caused it — it's automatic, not a matching decision). Wrapping both status changes in one transaction means a mid-sequence failure can never leave a ride at `REQUESTED` with no corresponding `SEARCHING_DRIVER` event, or vice versa.

Nothing beyond `SEARCHING_DRIVER` happens. There is no matching logic, no driver offer, no polling loop — the ride simply sits there until Phase 8 exists.

## Schema changes

`rides` gained one column and two indexes (migration `0002_ride_idempotency.sql`):

```sql
ALTER TABLE "rides" ADD COLUMN "idempotency_key" text NOT NULL;
CREATE UNIQUE INDEX "rides_passenger_idempotency_key_key" ON "rides" ("passenger_id","idempotency_key");
CREATE UNIQUE INDEX "rides_one_active_per_passenger_key" ON "rides" ("passenger_id")
  WHERE "status" IN ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','PASSENGER_ONBOARD','IN_PROGRESS');
```

Adding a `NOT NULL` column to a table that might already have rows surfaced two follow-on fixes, both applied:

- **`packages/database/src/seed.ts`** now supplies a generated `idempotencyKey` per seeded ride (a real client would, in this phase, generate one per attempt — seed data has no client, so a fresh key per row is the equivalent). Seeding also previously picked a *random* passenger for every sample ride, including the several with active statuses — with the new one-active-ride constraint in place, that could (and, on one seed run, did) assign two active-status rides to the same passenger and fail. Fixed by assigning the plan's 7 active-status rides to 7 distinct (shuffled) passengers, while terminal-status rides (which don't participate in the constraint) still pick randomly, same as before.
- **`packages/database/src/constraints.test.ts`**'s pre-existing `rides` fixtures needed an `idempotencyKey` added to every insert. Three new tests were added alongside them, directly exercising both new indexes at the database level (repeat idempotency key rejected; second active ride rejected; a new active ride *is* allowed once the previous one is terminal).

## Client: passenger-app

`RequestRideScreen` (previously a stub) now auto-submits on mount — there's no separate confirmation step here, since RideEstimateScreen's "Request Ride" button was already the confirmation. It generates one idempotency key via a lazy `useState` initializer (stable across re-renders of the same mount, so retries — including a double-tap on the "Try again" button — reuse it), calls `POST /rides`, and on success stores the returned `Ride` in `RideDraftContext` and navigates to `SearchingDriverScreen`. On failure it shows the server's error message and a retry button that resends the exact same request.

`SearchingDriverScreen` (also previously a pure stub) now shows the real ride it was handed — route, status, and fare — instead of generic placeholder text, while still being explicit that there's nothing to actually *do* with that ride yet ("built in Phase 8").

## Tests

- `apps/api/src/routes/rides.test.ts` — 12 tests against real Postgres: happy-path creation with the full `REQUESTED`→`SEARCHING_DRIVER` `ride_events` history, the never-trust-client-fare check, idempotent replay, the active-ride conflict, both concurrency races described above, a disabled-account rejection, validation, and role/auth gating. Run repeatedly for repeatability (86/86 total API tests, multiple times).
- `packages/database/src/constraints.test.ts` — 3 new tests for the two new unique indexes plus the "a new active ride is fine once the old one is terminal" positive case.
- `packages/validation/src/ride.test.ts`, `packages/types/src/index.test.ts` (extended) — schema and shape tests, including a `@ts-expect-error`-backed check that `CreateRideRequest` structurally has no fare field.
- `apps/passenger-app`: `idempotencyKey.test.ts` (new), `apiClient.test.ts` (extended for `createRideRequest`).
- Manual/live verification against a running server: create → 201 with a real computed fare; retry with the same key → 200, same ride; a second, different request while the first is active → 409.

## Known limitations

- No way for a passenger to cancel a `SEARCHING_DRIVER` ride yet — cancellation pathways are Phase 9's job.
- No way to *see* an active ride resume after an app restart (no `GET /rides/active`) — deliberately left out of this phase's scope; `RequestRideScreen`'s response already carries everything `SearchingDriverScreen` needs, and a resume-after-restart flow is more naturally something a later phase (with real matching/realtime state to resume into) should design around.
- Idempotency-key replay returns the *original* ride regardless of whether the retried request's payload actually matches (e.g., a different pickup) — true idempotency semantics would detect and reject a payload mismatch under the same key. Not implemented; documented as a simplification.
- `passenger eligibility` checks only what Stage 1 has actually built (`isActive`, has a passenger profile) — not a complete real-world eligibility model.
