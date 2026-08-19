# Cancellation Engine — Phase 17

## Scope

Section 17: implement passenger, driver, and system cancellation;
cancellation rules configurable; record actor, reason, ride state,
timestamp, and potential TEST fee; if appropriate, let driver
cancellation return the ride to matching; prevent invalid
terminal-state cancellation.

All three cancellation pathways, the terminal-state guard, and the
`actor`/`reason`/`ride state`/`timestamp` record already existed from
Phase 9 (`rideLifecycleService.cancelRide`, `ride_events`,
`CANCELLABLE_STATUSES`) — this phase's job was the two pieces Phase 9
deliberately left for later: a configurable cancellation fee, and the
"driver cancellation can return ride to matching" behavior, itself
configurable. One migration (`0008_solid_hairball.sql`) adds
`rides.cancellation_fee_cents`.

## Cancellation fee — "record potential TEST fee"

`rideLifecycleService.computeCancellationFeeCents(actor, rideStatus)`:

- **Zero** for `DRIVER` and `SYSTEM` cancellations, always — Stage 1
  never charges a driver, and a system cancellation is never anyone's
  fault.
- **Zero** for a `PASSENGER` cancellation from `REQUESTED` or
  `SEARCHING_DRIVER` — no driver has been dispatched yet, so cancelling
  costs nothing.
- **The active pricing config's `cancellationFeeCents`** for a
  `PASSENGER` cancellation from `DRIVER_ASSIGNED`, `DRIVER_EN_ROUTE`, or
  `DRIVER_ARRIVED` — a driver has already committed time to this ride.

The fee amount is configurable the same way fares are:
`pricing_configs.cancellationFeeCents` already existed (Phase 6),
versioned via the existing `POST /admin/pricing/configs` (`SUPER_ADMIN`
"change pricing" endpoint) — no new config surface was needed for the
*amount*, only for what triggers it (above).

**"Potential" is deliberate and literal.** This computes and *records*
what the fee would be — on the `rides` row (`cancellationFeeCents`,
`0` once the ride is terminally cancelled with no fee applicable, the
config's amount when it is) and in the corresponding `ride_events` row's
`metadata` (`{ reason, cancellationFeeCents }`) — but nothing here
actually charges it. No `payment_records` row is created for a
cancellation fee anywhere in this phase; see Known Limitations.

`Ride.cancellationFeeCents` (the client-facing field) is `null` only
when the ride was never terminally cancelled at all (including the
"returned to matching" driver-cancellation path below) — once
terminally cancelled, it's always a number (`0` or the fee), never
`null`.

## "If appropriate, driver cancellation can return ride to matching"

**Appropriate** is read as two conditions, both of which have to hold:

1. A driver was actually dispatched (`ride.driverId` is set) — there's
   a ride worth rescuing, not just an abstract cancellation.
2. The operator's configured policy allows it (see below).

When both hold, `cancelByDriverAndReturnToMatching` runs instead of the
terminal path: the ride transitions back to `SEARCHING_DRIVER` (driver
un-assigned, `matchedAt` cleared, the driver released to `ONLINE`), and
`matchingService.advanceToNextCandidate` is re-triggered best-effort —
same "must not fail the primary action" precedent as
`rideService.requestRide`'s own `startMatching` call.
`matchingService.findTriedDriverIdsForRide` already excludes every
driver with an existing `ride_requests` row for this ride regardless of
status, so the driver who just cancelled is never immediately
re-offered the ride they gave up — no extra exclusion logic was needed.

The cancellation is still fully **recorded** even though the ride
itself isn't terminated: the `ride_events` row for this transition
(`previousStatus` → `SEARCHING_DRIVER`, `actorType: 'DRIVER'`) carries
`metadata: { cancelledBy: 'DRIVER', reason, cancellationFeeCents: 0,
returnedToMatching: true }` — the same actor/reason/ride-state/
timestamp/fee fields the terminal path writes, just without touching
`rides.cancelled*`/`cancellationFeeCents` on the row itself (the ride
isn't cancelled — see that column's own schema comment). If the ride is
later cancelled for good (by a new driver, the passenger, or the
system), *that* event is what sets those columns — the full timeline
(driver cancelled → re-matched → eventually resolved) survives intact
in `ride_events`, uncollapsed.

When appropriate doesn't hold — no driver was assigned yet (can't
happen: a driver can only ever cancel a ride they're assigned to), or
the policy below is turned off — driver cancellation falls back to the
original Phase 9 terminal path: `CANCELLED_BY_DRIVER`, same as
passenger/system cancellation's own terminal transitions.

### The policy: `cancellation.driver_return_to_matching`

"Cancellation rules configurable" is satisfied concretely by reusing
Phase 14's generic `system_settings` key/value mechanism rather than
building a new dedicated config surface:

- **Key**: `cancellation.driver_return_to_matching`
- **Value**: a JSON boolean
- **Default when unset**: `true` (return to matching) — losing a driver
  mid-dispatch shouldn't force the passenger to start over unless an
  operator has deliberately turned that behavior off.
- **Set via**: the existing `PUT /admin/settings/:key` (`SUPER_ADMIN`
  only) — no new endpoint, and admin-app's existing generic Settings
  page (arbitrary key + JSON value form, built in Phase 14) already
  supports writing it with no frontend changes.

Flipping it to `false` makes every driver cancellation terminal
(`CANCELLED_BY_DRIVER`) again, restoring the exact Phase 9 behavior —
verified directly in `cancellation.test.ts`.

## Prevent invalid terminal-state cancellation

Unchanged from Phase 9, and still the single gate every cancellation
path goes through before anything else: `CANCELLABLE_STATUSES`
(`REQUESTED`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_EN_ROUTE`,
`DRIVER_ARRIVED`). A ride in `PASSENGER_ONBOARD`/`IN_PROGRESS`/
`COMPLETED`/any `CANCELLED_BY_*` state rejects every cancellation
attempt with `409`, regardless of actor. The new driver-return-to-
matching branch sits *after* this check, not instead of it — it can
only ever fire from a state the guard has already accepted.

## Routes

No new routes. The existing `POST /rides/:id/cancel` (passenger) and
`POST /drivers/me/rides/:id/cancel` (driver) now return a `Ride` whose
`status` may be `SEARCHING_DRIVER` (driver cancellation, returned to
matching) in addition to the three terminal outcomes, and whose
`cancellationFeeCents` is populated per the rule above.
`cancelRideBySystem` (no HTTP route in Stage 1, same as before) is
unaffected by the return-to-matching branch — only `DRIVER` actor
cancellations are eligible for it.

## Client changes

**passenger-app**: `DriverAssignedScreen` previously had no branch for
`ride.status === 'SEARCHING_DRIVER'` — with driver cancellation now
able to produce that status instead of a terminal `CANCELLED_BY_*`, the
screen would have sat there indefinitely showing stale driver
information. It now alerts the passenger ("your driver had to cancel —
we're finding you a new one") and navigates to `SearchingDriverScreen`,
which already polls and re-advances the moment a new driver is found —
no changes needed there. A passenger's own self-cancel
(`DriverAssignedScreen.handleCancel`) now surfaces the cancellation fee
in its confirmation alert when one applies.

**admin-app**: `/rides/[id]` gained a "Cancellation fee" field
alongside the existing cancelled-at/by/reason fields.

**driver-app**: no changes needed — `ArrivalScreen`/
`PickupNavigationScreen`'s cancel handlers already unconditionally
clear `ActiveRideContext` and navigate to `DriverHomeMap` regardless of
the ride's resulting status, which is correct for both outcomes (the
cancelling driver is done with this ride either way).

## Tests

`apps/api/src/routes/cancellation.test.ts` (11 tests), against a real
PostgreSQL database:

- No fee before a driver is assigned; the configured fee once one is;
  zero fee for a system cancellation regardless of ride state; a
  cancellation fee is never actually charged (no `payment_records` row
  is ever created for one).
- Driver cancellation (default policy): returns the ride to
  `SEARCHING_DRIVER`, releases the driver to `ONLINE`, and a second
  eligible driver receives the offer while the first driver does not
  (confirmed via each driver's own `GET /drivers/me/offer`); the
  `ride_events` row for the cancellation carries actor/reason/fee/
  `returnedToMatching` metadata; the ride remains fully cancellable
  afterward by the newly-matched driver or the passenger.
- Policy toggle: disabling `cancellation.driver_return_to_matching`
  (inserted directly, and via the real `PUT /admin/settings/:key`
  endpoint as a `SUPER_ADMIN`) makes driver cancellation terminal again.
- Terminal-state guard: a completed ride rejects a driver's cancel
  attempt (`409`); `cancelRideBySystem` rejects re-cancelling an
  already-cancelled ride.
- Admin ride detail (`GET /admin/rides/:id`) exposes the recorded fee.

`apps/api/src/routes/rideLifecycle.test.ts`'s own driver-cancellation
test was updated in place: it now asserts the new default outcome
(`SEARCHING_DRIVER`, not `CANCELLED_BY_DRIVER`) for a driver cancelling
an assigned ride, since that Phase 9 assertion predated this phase's
default policy.

Full repo verification after this phase: lint, typecheck, and build all
pass across every workspace; a from-zero `db:migrate` is clean; 224
tests passing in `apps/api` (up from 213 before this phase);
passenger-app/driver-app/admin-app's existing unit test suites are
unaffected; `next build` still produces every admin-app route with no
errors.

## Manual test procedure

1. As a `PASSENGER`, request a ride and cancel it immediately (before a
   driver is assigned). Confirm the response — and `GET /rides/:id` —
   shows `cancellationFeeCents: 0`.
2. Request another ride, let a `DRIVER` accept it, then cancel as the
   passenger from `DriverAssignedScreen`. Confirm the app's alert
   mentions a cancellation fee, and that `GET /admin/rides/:id` (as
   `ADMIN`) shows the configured fee amount under "Cancellation fee."
3. Request a ride, let a driver accept, then cancel from the **driver**
   side. Confirm (a) the driver-app returns to `DriverHomeMap` and the
   driver goes back `ONLINE`, and (b) the passenger's app — left open on
   `DriverAssignedScreen` — shows the "finding you a new driver" alert
   and lands back on `SearchingDriverScreen`, still polling the same
   ride.
4. Have a second eligible driver online nearby; confirm they receive a
   new offer for that same ride shortly after step 3's cancellation.
5. As `SUPER_ADMIN`, set `cancellation.driver_return_to_matching` to
   `false` via Settings. Repeat step 3; confirm the ride now goes
   straight to `CANCELLED_BY_DRIVER` and the passenger's app shows the
   "your driver cancelled this ride" alert instead.
6. Confirm a `COMPLETED` or already-`CANCELLED_*` ride still rejects a
   cancellation attempt from any actor with `409`.

## Known limitations

- **The cancellation fee is recorded, never charged.** No
  `payment_records` row, Stripe TEST MODE PaymentIntent, or any other
  charge is created for a cancellation fee anywhere in this phase — see
  the spec's own "potential" wording, read literally. Actually
  collecting it (e.g. reusing `paymentService.runPaymentAttempt`'s
  shape) would be a natural, self-contained follow-up, not attempted
  here to keep this phase's scope to what "Record: ... potential TEST
  fee" actually asks for.
- **The fee rule is a fixed two-tier threshold, not a graduated
  schedule.** "No fee before a driver is assigned, one flat fee after"
  is the entire rule — no free-cancellation grace period after
  assignment, no escalating fee by how long the driver waited, no
  per-ride-distance component. `pricing_configs.cancellationFeeCents`
  is a single flat amount, same as it was before this phase.
- **`cancellation.driver_return_to_matching` is a single global
  toggle**, not configurable per city/region/driver tier — Stage 1 has
  no such dimension to key it on regardless.
- **No notification fires for either cancellation outcome.** Section
  16's canonical event list has no "ride cancelled" entry, so neither
  the terminal path nor the return-to-matching path sends a push/in-app
  notification — the passenger/driver apps only learn about it via
  their existing ride-status poll loop, not a `NotificationProvider`
  event.
