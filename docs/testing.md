# Automated Testing — Phase 21

## Scope

Phase 21 asked for the test suite to be reviewed against six categories —
unit, integration, API, database, concurrency, E2E — and for one
specific, spec-literal Critical E2E flow to exist and pass. This doc is
the map of where each category lives; it doesn't re-describe what
individual phases' own docs (`docs/matching-engine.md`,
`docs/ride-lifecycle.md`, `docs/payments.md`, etc.) already cover in
depth.

The audit behind this phase was a grep-based sweep of every route file's
endpoints (85 `router.*` definitions in `apps/api/src/routes/`) against
every `*.test.ts` file's exercised paths, plus a read of `app.test.ts`
and `authorization.test.ts` (the two files not named after a specific
route module). Conclusion: the suite already had full route-level
coverage from Phases 1–20, each of which wrote its own tests as it went
(see each phase's own doc for what it covers). This phase's job was to
fill the two things that audit found genuinely missing — a single
continuous Critical E2E test, and a concurrency test for a specific race
that had never been exercised — not to duplicate 20 phases of existing
work.

## Where each category lives

| Category | Where | Example |
|---|---|---|
| **Unit** | `packages/*/src/**/*.test.ts` — pure logic, no I/O, no database | `packages/pricing/src/pricingEngine.test.ts`, `packages/matching/src/scorer.test.ts`, `packages/auth/src/password.test.ts`, `packages/validation/src/*.test.ts` |
| **Integration** | `apps/api/src/routes/*.test.ts` — real Express app (`createApp()`) + real Postgres (`rideshare_test`) via `supertest`, not mocks | Every route file, e.g. `rideLifecycle.test.ts`, `payments.test.ts`, `earnings.test.ts` |
| **API** | Same files as integration — every test asserts on the actual HTTP response (status code, body shape), not just service-layer return values | All of the above |
| **Database** | `packages/database/src/constraints.test.ts` — asserts CHECK/FK/UNIQUE constraints are enforced by Postgres itself, not just declared in Drizzle schema | See "Database constraint tests" below |
| **Concurrency** | Dedicated `describe` blocks inside relevant route test files, using `Promise.all` against the same real database | `driverOffers.test.ts` — two/50-driver accept race, 8-passenger independent-ride race (Phase 21) |
| **E2E** | `apps/api/src/routes/criticalPath.test.ts` — the full spec-literal flow, one continuous test | See below |

Frontend unit tests (`apps/*-app/src/**/*.test.ts(x)`) cover pure
client-side logic — formatting, idempotency key generation, region math,
env parsing — not full screen rendering; there's no component-testing
harness in this stack, consistent with every prior phase's own scope.

## Critical E2E: `criticalPath.test.ts`

One `it(...)` block runs the entire spec-literal sequence against a real
running app + real Postgres, start to finish, and fails loudly the moment
any single step doesn't hold:

```
passenger registers → driver registers (background) → pricing estimate
  → ride requested → driver receives + accepts offer → driver en route
  → driver arrives → picked up → ride starts → location updates
  → ride completes → TEST payment succeeds → driver earnings created
  → both ratings submitted → admin inspects ride/payment/ratings
```

Deliberately a single test, not several — the existing per-phase test
files already cover each step in isolation and in depth; this one test's
only job is to answer "does the whole thing work end to end," which a
suite of narrower tests can't answer on its own (each could pass while
the steps between them silently don't compose). A few notes on how the
spec's wording maps onto the actual API:

- **"chooses pickup" / "chooses destination"** — the ride request body's
  `pickup`/`destination` fields; there's no separate "choose" step
  server-side, matching Phase 7's design (`docs/ride-requests.md`).
- **"ride starts"** — two real transitions, both asserted:
  `PASSENGER_ONBOARD` (picked up) then `IN_PROGRESS` (start).
- **TEST payment** — the MOCK `PaymentProvider` (`docs/payments.md`);
  Stage 1 never configures real Stripe credentials in this environment,
  so "TEST payment succeeds" here means the same auto-charge-on-completion
  path every other payment test exercises, asserted via
  `GET /rides/:id/payment` returning `SUCCEEDED`.
- **Admin inspection** — a real admin account (direct DB insert, same
  pattern Phase 14's own tests use), logged in through the real
  `/auth/login` endpoint, then `GET /admin/rides/:id`,
  `GET /admin/payments`, and `GET /admin/ratings` all confirmed to show
  this exact ride.

## Concurrent, independent matching attempts (Phase 21)

`driverOffers.test.ts`'s new "concurrent ride requests — no
double-assignment across independent rides" test fires 8 concurrent
`POST /rides` from 8 different passengers against a pool of only 5
eligible drivers, then asserts no driver was offered more than one open
ride at once. This is a different race from the pre-existing "two drivers
accepting the same offer" tests — it's about two *different, unrelated*
rides' independent matching attempts contending for the same driver pool,
not two drivers racing for the same ride.

This test failed on its first real run (`expected 4 to be 8` — 8 offers
existed across only 4 distinct drivers) and led directly to a real fix,
not just a documented gap; see `docs/matching-engine.md`'s "Concurrent,
independent matching attempts" section for the root cause (a non-unique
index that didn't actually stop the race) and the fix (a real partial
`UNIQUE` index plus graceful next-candidate handling on race-loss).

## Database constraint tests

`packages/database/src/constraints.test.ts` runs directly against a real
Postgres instance (not a mock), truncating all tables between tests, and
asserts constraints are enforced by the database itself — CHECK
constraints (e.g. latitude/longitude ranges), FK `ON DELETE RESTRICT`
behavior, and UNIQUE constraints (idempotency keys, one-active-ride, and,
as of this phase, one-open-offer-per-driver). Phase 21 added three new
cases for `ride_requests_one_open_offer_per_driver_key`: rejects a
duplicate open offer for the same driver across different rides; allows
a new one once the prior offer is no longer open; allows the same driver
to be re-offered the *same* ride later (the constraint isn't scoped to
`rideId`, only `driverId`).

## Running the suite

```bash
# Everything (all workspaces)
npm run test --workspaces --if-present

# Just the backend (integration/API/E2E/most concurrency tests)
npm run test --workspace=apps/api

# Just the database constraint tests
npm run test --workspace=packages/database

# One file
npx vitest run src/routes/criticalPath.test.ts   # from apps/api
```

`apps/api`'s suite runs against `rideshare_test` (not `rideshare_dev`,
which is left for manual inspection) and sets `fileParallelism: false` —
several test files share database state (users, sessions), so files run
one at a time, not concurrently. Concurrency *within* a single test
(`Promise.all` against many drivers/passengers at once) is unaffected by
that setting; it's a separate axis from cross-file parallelism.

## Known limitations

- **No component/UI test harness for the three frontend apps.** Frontend
  test files cover pure logic (formatting, idempotency keys, region math)
  only — there's no rendered-screen assertion layer in this stack, and
  adding one wasn't judged proportionate to Stage 1's scope.
- **The Critical E2E test is one deliberately linear path**, not a
  fuzzer or a state-machine explorer — it proves the happy path
  composes end-to-end; edge cases (declines, timeouts, cancellations,
  disputed ratings, refunds) are covered by the narrower per-phase test
  files instead, not duplicated here.
- **Concurrency tests exercise real races via `Promise.all` against one
  shared test database**, not a dedicated load-testing tool — Phase 19's
  `simulate.ts` script (`docs/simulation-results.md`) is the closer
  approximation of true load, but is a manual/on-demand tool, not part
  of the automated suite this doc describes.
