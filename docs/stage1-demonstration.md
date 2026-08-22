# Stage 1 Demonstration — Phase 24

## Scope

Phase 24 ("Stage 1 Final Validation") asks for a "complete development
demonstration" of a specific 24-step scenario. This doc is that
demonstration: a walkthrough of the scenario mapped step-by-step to
its concrete evidence, plus how to run it and see it pass yourself.
It is not a second implementation of the scenario — the evidence is
`apps/api/src/routes/criticalPath.test.ts`, one continuous automated
test that drives a real passenger, a real (separate) driver, and a
real admin session through the entire story against a real
(test-fixture) Postgres database, asserting every step's server-side
effect along the way.

## Why an automated test, not a hand-run walkthrough

A one-time manual click-through would demonstrate the scenario once,
on one day, in one environment, and then stop proving anything the
moment any later phase changed a field name or a status transition.
`criticalPath.test.ts` demonstrates the same 24 steps and keeps
demonstrating them on every future run — it's Phase 21's "all critical
tests must pass" made literal, extended in this phase to name every
one of Phase 24's 24 steps explicitly. See that file's own top-of-file
comment for the full step-by-step table this doc summarizes below.

## The scenario, and its evidence

| # | Scenario step | Evidence |
|---|---|---|
| 1 | Passenger opens Passenger App | Client-side; `apps/passenger-app`'s own screens (`docs/driver-app.md`'s sibling docs) are the UI this test's API calls stand in for. |
| 2 | Passenger authenticates | `POST /auth/passengers/register` |
| 3 | Passenger selects pickup | The `pickup` coordinate the test constructs, standing in for `apps/passenger-app`'s map interaction |
| 4 | Passenger selects destination | The `destination` coordinate |
| 5 | Backend calculates estimate | `POST /pricing/estimate` |
| 6 | Passenger requests ride | `POST /rides` |
| 7 | Matching Engine searches drivers | Runs synchronously inside `POST /rides`; proven by the next step (an offer exists) |
| 8 | Driver receives offer, separate app | `GET /drivers/me/offer` using the driver's own token, never the passenger's |
| 9 | Driver accepts | `POST /drivers/me/offer/:id/accept` |
| 10 | Passenger receives driver information | `GET /rides/:id/driver`, asserted immediately after acceptance |
| 11 | Driver navigates to pickup | `POST /drivers/me/rides/:id/en-route` |
| 12 | Passenger sees driver location | `GET /rides/:id/driver` again, mid-travel, location non-null |
| 13 | Driver marks arrival | `POST /drivers/me/rides/:id/arrived` |
| 14 | Passenger boards | `POST /drivers/me/rides/:id/picked-up` |
| 15 | Driver starts ride | `POST /drivers/me/rides/:id/start` |
| 16 | Realtime tracking operates | Location pings recorded while `IN_PROGRESS`, confirmed visible via `GET /rides/:id/driver` |
| 17 | Driver completes ride | `POST /drivers/me/rides/:id/complete` |
| 18 | Backend calculates final TEST fare | `finalFareCents` on that same response |
| 19 | Stripe TEST payment processes | `GET /rides/:id/payment`, status `SUCCEEDED` |
| 20 | Driver TEST earnings recorded | `GET /drivers/me/earnings/summary` + `/history` |
| 21 | Platform TEST revenue recorded | `GET /admin/revenue` |
| 22 | Passenger rates driver | `POST /rides/:id/rating` |
| 23 | Driver rates passenger | `POST /drivers/me/rides/:id/rating` |
| 24 | Admin App displays entire operation | `GET /admin/rides/:id`, `/admin/payments`, `/admin/ratings`, `/admin/revenue`, using a real ADMIN session distinct from the passenger's and driver's |

## Run it yourself

```bash
# from a running dev database (see docs/deployment.md's quickstart)
npm run build:packages
npx vitest run src/routes/criticalPath.test.ts --workspace-root . \
  --root apps/api
# or, from apps/api directly:
cd apps/api && npx vitest run src/routes/criticalPath.test.ts
```

Expect one test file, one test, passing — the whole 24-step story in
a single continuous run. The full `apps/api` suite (`npm run test`
from `apps/api`) runs this alongside every other test file; see
`docs/testing.md`.

## What this demonstration does not claim

Every "TEST" prefix above is literal, not decorative — Stripe payments
run in TEST MODE only (`docs/deployment.md`'s "Payments" section),
driver/platform "earnings" and "revenue" are bookkeeping over that
same TEST money, and the entire run happens against fictional
fixture accounts created by the test itself, never real user data.
Nothing in this demonstration performs a real ride, moves real money,
or should be read as evidence of production readiness beyond what
`docs/production-readiness.md` and `PRODUCTION_READINESS_CHECKLIST.md`
already state explicitly.
