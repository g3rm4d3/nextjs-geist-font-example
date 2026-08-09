# Pricing Engine — Phase 4

## Why pricing is centralized and server-only

Section 3's rule — mobile/web clients are never the authoritative source
for a fare — is the entire design constraint of this phase. Nothing in
`apps/passenger-app` (or any future client) computes, estimates, or
locally adjusts a dollar amount. Every fare a user ever sees comes from
one function, called from one place, running on `apps/api`:
`@rideshare/pricing`'s `calculateFare`, called by
`apps/api/src/services/pricingService.ts`.

Critically, the client also never supplies the *inputs* to that
function. `POST /pricing/estimate` takes raw `origin`/`destination`
coordinates, not a client-computed `distanceMeters`/`durationSeconds` —
`pricingService.getFareEstimate` recomputes the route itself via
`@rideshare/maps` (the same `RouteProvider` Phase 3 introduced) before
pricing it. If the server priced whatever distance/duration a client
handed it, "the math is server-side" wouldn't actually mean anything —
the inputs to that math would still be client-trusted. This closes that
gap from day one, the same way ride-request handling will need to in a
later phase.

## `@rideshare/pricing`

A small, dependency-free package (no runtime deps at all) exporting one
function and one error type:

```ts
function calculateFare(input: FareEstimateInput, config: PricingConfig): FareBreakdown;
class PricingError extends Error {}
```

```ts
interface PricingConfig {
  baseFareCents: number;
  perMileRateCents: number;
  perMinuteRateCents: number;
  minimumFareCents: number;
  bookingFeeCents: number;
  platformCommissionPercentage: number; // 0–100
}

interface FareEstimateInput {
  distanceMeters: number;
  durationSeconds: number;
}

interface FareBreakdown {
  baseFareCents: number;
  distanceFareCents: number;
  timeFareCents: number;
  bookingFeeCents: number;
  subtotalCents: number;
  minimumFareCents: number;
  minimumFareApplied: boolean;
  totalCents: number;
  platformCommissionCents: number;
  driverEarningsCents: number;
}
```

It is a pure function: given the same input and config, it always
returns the same breakdown, and it never reads the database, the clock,
or anything else — `pricingService` is what wires it to real data.

### Cents only (section 10)

Every monetary field in and out is an integer number of cents. The only
place non-integer arithmetic happens is internally, converting
`distanceMeters` → miles and `durationSeconds` → minutes to multiply
against the per-mile/per-minute rates — and that result is rounded back
to a whole cent with `Math.round` immediately, before it's added to
anything else. Nothing downstream of `calculateFare` ever sees or
touches a fractional cent.

### Minimum fare

```
subtotalCents = baseFareCents + distanceFareCents + timeFareCents + bookingFeeCents
totalCents     = max(subtotalCents, minimumFareCents)
minimumFareApplied = totalCents > subtotalCents
```

`minimumFareApplied` is derived, not separately tracked — it's simply
whether the floor actually changed the number, which keeps it
impossible for the flag and the total to disagree.

### Commission math and the ledger invariant

```
platformCommissionCents = round(totalCents * platformCommissionPercentage / 100)
driverEarningsCents     = totalCents - platformCommissionCents
```

`driverEarningsCents` is **derived by subtraction, not independently
rounded**. Rounding both `totalCents * pct%` and `totalCents * (100-pct)%`
separately can disagree by a cent (e.g. 33.33% of an odd total). Deriving
the driver's share as "whatever's left" instead guarantees

```
platformCommissionCents + driverEarningsCents === totalCents
```

exactly, always — which matters because that's the same balance the
`driver_earnings` table's `CHECK` constraint (Phase 1) will enforce once
rides actually complete and get paid out. The pricing engine and the
ledger agree by construction, not by coincidence.

### What's deliberately not implemented yet

Per section 4, `PricingConfig` has no ride category, geographic pricing
zone, or dynamic/surge multiplier field, and `calculateFare` has no
demand-based adjustment logic. These are explicitly named in the spec as
*potential future configuration* — adding them now would mean pricing
users differently before there's any of the matching/dispatch machinery
(a later phase) that would make that meaningful, and would make today's
fare non-reproducible for testing. All fares in Stage 1 are flat-rate,
config-driven, and deterministic for a given route.

### Tests

`packages/pricing/src/pricingEngine.test.ts` — 24 tests, all pure
(no I/O):

- Itemized output shape for a normal trip.
- Minimum fare: below the floor, above the floor, and exactly equal to
  it (the `minimumFareApplied` boundary).
- Rounding: an exact `.5`-cent case verified to round predictably, plus
  a property-style check that fare fields are never fractional.
- Zero values: zero distance/duration are **valid** inputs (a
  minimum-fare trip), not errors.
- Invalid values: negative distance/duration, `NaN`/`Infinity`, a
  negative config field, and a commission percentage outside `[0, 100]`
  all throw `PricingError`.
- Long rides: a 500 mi / 5 hr trip, asserting exact cent values with no
  overflow or precision drift.
- Commission calculation: parameterized over `[0, 10, 17.5, 20, 33.33,
  50, 100]` percent, each asserting the ledger invariant above, plus
  explicit 0%/100% edge cases.

## Where the config comes from

`pricing_configs` (Phase 1's schema) holds versioned pricing
configurations, with a partial unique index allowing at most one row
with `active = true` at a time — "the active config" is unambiguous by
construction, no query-time tiebreaking needed.
`apps/api/src/repositories/pricingConfigsRepository.ts`'s
`findActivePricingConfig()` reads that row. The seed (`packages/database/src/seed.ts`)
always inserts one active `default` config, so a freshly migrated and
seeded database always has a fare to compute. If no active row exists
(a misconfigured or unseeded database), `pricingService.getFareEstimate`
throws a generic 500 — that's an operational error, not something a
client request can trigger.

Note: `platform_commission_percentage` is a Postgres `numeric` column,
which `drizzle-orm` returns as a `string` (to avoid silent precision
loss on values too large for a JS `number`). `pricingService` converts
it with `Number(...)` before handing it to `calculateFare` — safe here
because the column is constrained to `[0, 100]` with 2 decimal places
(`pricing_configs_commission_range_chk`).

## `POST /pricing/estimate`

- **Auth:** `requireAuth` — any authenticated user (passenger or driver).
- **Rate limit:** `pricingEstimateLimiter` (30 requests/minute).
- **Body:** `{ origin: Coordinate, destination: Coordinate }`, validated
  by `routePreviewSchema` from `@rideshare/validation` — reused as-is
  rather than duplicated, since the shape is identical to
  `POST /routes/preview`'s and the two should never silently drift apart.
- **Response:** a `FareEstimate` (`packages/types/src/pricing.ts` — a
  hand-mirrored copy of `FareBreakdown`, kept dependency-free on purpose,
  matching how `packages/types` treats every other shared API shape).

Covered by `apps/api/src/routes/pricing.test.ts` against a real seeded
Postgres database (never mocked, per the established testing
philosophy): an itemized-fare happy path asserting the ledger invariant,
a zero-distance trip asserting the minimum fare applies, a 401 for an
unauthenticated request, and a 400 for an out-of-range coordinate.
Because only one `pricing_configs` row can be active at a time, the test
file's `beforeAll` deactivates whatever's currently active and inserts
its own known-value config for deterministic assertions, then restores
nothing but deletes its own row in `afterAll` — leaving the database's
seeded `default` config deactivated. This is fine for an isolated test
run against a disposable database, but **running this test file leaves
no config active** — a follow-up `db:seed` or manually re-activating
`default` is needed before manually exercising the endpoint again. Ran
twice back to back to confirm repeatability (47/47 API tests passing
both times).

## Passenger app: `RideEstimateScreen`

Phase 3 left this screen showing distance/duration with a "Coming in
Phase 4" placeholder where the fare would go. It now calls
`apiClient.getFareEstimate(accessToken, { origin, destination })` →
`POST /pricing/estimate`, using the same pattern
`RoutePreviewScreen` established for satisfying the
`react-hooks/set-state-in-effect` ESLint rule: a named async function
declared inside `useEffect`, invoked via `void loadFareEstimate(...)`,
rather than calling `setState` synchronously at the top of the effect
body.

While loading, it shows a spinner; on failure, an error message (via the
same `ApiClientError` pattern as the rest of the app); on success, an
itemized breakdown — base fare, distance, time, booking fee, a
"Minimum fare applied" line when `minimumFareApplied` is true, and the
total — each formatted with the new `formatCents` helper
(`src/lib/format.ts`, unit-tested in `format.test.ts`). The "Request
Ride" button stays disabled until a fare has actually loaded.

## Known limitations

- No dynamic/surge pricing, ride categories, or geographic pricing
  zones — explicitly out of scope for this phase (see above).
- `calculateFare` is a pure function with no currency/locale awareness;
  all amounts are USD cents. Formatting (`formatCents`) is
  presentation-only and never feeds back into any calculation.
- The route priced is still the Phase 3 haversine `RouteProvider` MOCK —
  a fare computed from an approximate straight-line distance is itself
  approximate. Swapping in a real routing provider later changes the
  input to `calculateFare`, not the pricing logic itself.
- No caching: every `POST /pricing/estimate` recomputes the route and
  the fare from scratch. Fine at Stage 1's scale; worth revisiting if a
  future phase calls this endpoint at high frequency (e.g. live re-quoting).
- As noted above, running `pricing.test.ts` deactivates the seeded
  `default` pricing config as a side effect; a real deployment would
  need a `db:seed` (or equivalent) after running tests against it before
  manual/API smoke-testing again.
