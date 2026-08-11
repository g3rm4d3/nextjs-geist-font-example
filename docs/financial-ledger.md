# Financial Ledger — Phase 12

## Scope

Section 12: "Create driver earnings ledger." For every completed test
ride, record gross fare, platform commission, driver gross earnings,
adjustments, and a payout status placeholder — then let a driver see
Today/Week/Month totals plus ride history, and let an admin see platform
test revenue. **Do NOT implement real payouts** — `payout_status` stays
a real, honest placeholder column that nothing in Stage 1 ever
transitions to `PAID`.

No schema migration was needed: `driver_earnings` (rideId, driverId,
grossFareCents, platformCommissionCents, driverGrossEarningsCents,
adjustmentsCents default 0, payoutStatus default `PENDING`, a unique
index on `ride_id`) was already fully defined in Phase 1's schema,
anticipating this phase — see `packages/database/src/schema/*.ts`'s
comment on `driverEarningsCents` and `pricingEngine.ts`'s own comment:
*"later phases (Phase 12's earnings ledger) need the commission/driver
split, not just the customer-facing total."* Nothing populated the table
until now — it existed only for `seed.ts`'s sample data.

## No second fare calculation

`rideLifecycleService.completeRide` already computes a full
`FareBreakdown` (via `pricingService.getFareForActualTrip`) to get the
ride's `final_fare_cents`. That same object also carries
`platformCommissionCents` and `driverEarningsCents` — Phase 4's pricing
engine was built to return the full split, not just a total, for exactly
this reason. `earningsService.recordEarningsForCompletedRide` is called
immediately after, passing that *same* `fare` value straight through:

```ts
await recordEarningsForCompletedRide(rideId, driverId, fare);
// -> grossFareCents: fare.totalCents
// -> platformCommissionCents: fare.platformCommissionCents
// -> driverGrossEarningsCents: fare.driverEarningsCents
```

There is no second pricing calculation anywhere in this phase — the
ledger and the ride's own `final_fare_cents` can never independently
drift apart, because they're never independently computed in the first
place.

## Best-effort, same as Phase 11's charge

`recordEarningsForCompletedRide` is called from `completeRide` in its
own try/catch, immediately after `paymentService.chargeRideFare`'s own
try/catch — a ledger-write hiccup must not fail ride completion any more
than a payment-provider hiccup does. It's also idempotent: `driver_earnings_ride_id_key`
(a unique index) is the actual guarantee, checked first
(`findDriverEarningsByRideId`) for a cheap, friendly no-op rather than a
caught constraint violation — the same "read-first, write-once" shape
`chargeRideFare` itself uses.

## Aggregation

`earningsRepository.ts` introduces this codebase's first `SUM`/`COUNT`
aggregate queries (via drizzle-orm's `sum()`/`count()` helpers). Postgres
returns `SUM` over an integer column as text (avoiding precision loss
the `pg` driver can't otherwise guarantee) — converted to `Number` on
the way out, safe at Stage 1's cents-denominated scale. Two entry
points, same underlying shape:

- `sumDriverEarningsSince(driverId, since)` — one driver, `createdAt >= since`.
- `sumPlatformEarnings(since?)` — every driver, `since` omitted means all-time.

`earningsService` calls each three or four times (Today/Week/Month, plus
All time for the admin view) with UTC boundaries computed locally
(`startOfUtcDay`/`startOfUtcWeek`/`startOfUtcMonth` — week starts
Monday, ISO-style). Three independent windows, not a rolling chart or a
single query with `GROUP BY` — matches "Driver sees: Today / Week /
Month" as three fixed, always-present figures.

## Routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/drivers/me/earnings/summary` | Driver-only; `{ today, week, month }`, each `{ rideCount, grossFareCents, platformCommissionCents, driverGrossEarningsCents, adjustmentsCents }`. |
| `GET` | `/drivers/me/earnings/history` | Driver-only; every `driver_earnings` row for the caller, most recent first, joined per-row with the ride (pickup/destination labels, `completedAt`) and its latest payment status — same "per-row lookup, fine at Stage 1's scale" trade-off `routes/admin.ts`'s active-rides listing already established for vehicles. |
| `GET` | `/admin/revenue` | Admin-only (`ADMIN`/`SUPER_ADMIN`); `{ today, week, month, allTime }`, platform-wide (no `driverId` filter). |

## Client changes

**driver-app**: `EarningsScreen` and `HistoryScreen` — both previously
honest stubs pointing at this exact phase — are now functional.
`EarningsScreen` renders one card per window, headlined by
`driverGrossEarningsCents` (what the driver actually keeps) with gross
fare and the platform's cut as supporting detail. `HistoryScreen` lists
every `driver_earnings` row with its route, fare breakdown, payment
status badge, and payout status label.

**admin-app**: a new `/revenue` page, linked from the dashboard, mirrors
the driver Earnings screen's shape (Today/Week/Month + All time cards)
platform-wide, fetched once on load with a manual "Refresh" button
rather than the fleet map/active-rides pages' continuous polling —
revenue has no reason to be watched second-by-second.

## Tests

`apps/api/src/routes/earnings.test.ts` (8 tests), against a real
PostgreSQL database, driving full passenger/driver registration →
matching → lifecycle → `COMPLETED` flows via HTTP:

- Completing a ride records a `driver_earnings` row whose
  `grossFareCents`/`platformCommissionCents`/`driverGrossEarningsCents`
  match the ride's fare breakdown exactly (commission computed
  independently in the test from the same pricing config, for a real
  cross-check, not a tautology).
- Idempotency: calling `recordEarningsForCompletedRide` a second time
  for the same ride — with a deliberately different commission value —
  does not create a second row or overwrite the first.
- `GET .../summary` reflects a just-completed ride in every window and
  is correctly isolated per driver (a driver who completed nothing sees
  all zeros).
- Driver-only role gating (`403` for a passenger token).
- `GET .../history` lists the completed ride with the right fare
  breakdown, route labels, `payoutStatus: 'PENDING'`, and
  `paymentStatus: 'SUCCEEDED'` (the default test payment method always
  succeeds) — and correctly excludes another driver's rides.
- `GET /admin/revenue`: a before/after delta check (two new rides
  completed between reads) proves the platform-wide aggregate actually
  moves by at least the two rides' fare/commission in every window,
  robust against whatever earlier tests already put in the shared
  database. Admin-only role gating (`403` for driver and passenger
  tokens).

Full repo verification after this phase: lint, typecheck, and a clean
`rm -rf packages/*/dist && npm run build` all pass; a from-zero
`db:migrate` + `db:seed` is clean (no migration was needed this phase,
but verified anyway); 146 tests passing in `apps/api` (up from 138
before this phase), every other workspace's suite unaffected.

## Known limitations

- **UTC windows, not the driver's local timezone.** "Today" flips over
  at UTC midnight regardless of where a driver actually is — a real
  deployment would need per-driver (or per-market) timezone awareness.
- **`adjustments_cents` has no writer.** The column is real and included
  in every summary/history response, but nothing in Stage 1 ever sets it
  to a non-zero value — there is no manual-adjustment or dispute-resolution
  flow yet.
- **No real payouts, by explicit design.** `payout_status` stays
  `PENDING` forever; there is no Stripe Connect (or any other payout
  rail) integration, no "mark as paid" action anywhere, admin or
  otherwise. If a future phase adds real payouts, this is the column it
  would start transitioning.
- **History has no pagination.** `GET /drivers/me/earnings/history`
  returns the most recent 50 rows and stops — fine at Stage 1's ride
  volume, not a real keyset/offset pagination scheme.
- **Admin revenue has no per-driver or per-ride drill-down.** It's four
  platform-wide numbers, not a filterable ledger — Phase 14's broader
  admin tooling is the more natural home for that.
