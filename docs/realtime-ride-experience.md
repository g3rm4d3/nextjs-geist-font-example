# Realtime Ride Experience — Phase 10

## Scope

Section 10, three surfaces: the passenger app displays its assigned
driver (name, vehicle, plate, live location, ETA); the driver app shows
the passenger's pickup, a route line, and the destination once
appropriate; the admin console shows active rides. Underneath all three:
realtime-ish location updates (polling — Stage 1 has no push transport)
and actually tracking a ride's real distance/duration/route samples,
with configurable GPS sampling so that never means storing every raw
ping forever.

## The bug this phase found and fixed

Phase 8 flips a driver's `availability_status` to `BUSY` the moment they
accept an offer. `DriverHomeMapScreen`'s location-reporting loop
(Phase 6) only ever ran while `availabilityStatus === 'ONLINE'` — so a
driver stopped sending their position to the server the instant they
picked up a ride, exactly when Phase 10's "driver location" requirement
needs it most. Fixed by reporting while **either** `ONLINE` **or**
holding a non-terminal ride (`ActiveRideContext`), not just `ONLINE`.
`DriverHomeMapScreen` stays mounted underneath every ride-lifecycle
screen (native-stack keeps prior screens alive), so the same long-lived
watch subscription just keeps reporting through the whole ride without
any screen needing its own separate reporting loop.

## Two independent throttles, two independent concerns

| | `driver_locations` (current position) | `ride_location_samples` (route history) |
|---|---|---|
| Written | On every ping, throttled to at most once per **2s** (fixed, Phase 6, `MIN_WRITE_INTERVAL_MS`) | Only while a ride is `IN_PROGRESS`, throttled to at most once per **`RIDE_LOCATION_SAMPLE_INTERVAL_MS`** (env-configurable, default 10s) |
| Rows | One per driver, upserted in place | One row per sample, kept for the ride's history |
| Answers | "Where is this driver *right now*?" | "What path did this specific ride actually take?" |

Both throttles live in `locationService.recordLocation` — one function,
one incoming ping, two independent decisions about what (if anything) to
persist from it. This is the concrete answer to "use configurable GPS
sampling" and "do not persist unnecessary high-frequency data": the
route-history throttle is deliberately coarser than, and independent of,
the current-position one, and its interval is a single env var rather
than a hardcoded constant.

Route samples are scoped to `IN_PROGRESS` specifically — not
`DRIVER_EN_ROUTE`/`DRIVER_ARRIVED` — matching Phase 9's own definition of
"the actual ride" as the `started_at`..`completed_at` window. A driver
navigating to pickup isn't yet "on the ride" this table is a history of.

## Actual distance, now genuinely measured

Phase 9 shipped `completeRide` reusing the pre-trip route estimate for
`actual_distance_meters`, documented as a known limitation ("no live
route tracking"). Phase 10 closes that gap: `computeActualDistanceMeters`
sums consecutive-sample haversine distances (`@rideshare/maps`'s newly-
public `haversineDistanceMeters`, extracted from the MOCK RouteProvider
for exactly this second use) across every recorded sample for the ride.
Falls back to the pre-trip estimate only when fewer than two samples
exist — a ride that completes faster than one sampling interval, common
in manual/test runs, genuinely has nothing to sum. `actual_duration_seconds`
was already real elapsed wall-clock time (Phase 9); distance is real now
too, at whatever resolution the sampling interval allows — finer sampling
tracks the true path more closely, at the storage-growth cost the
"do not persist unnecessary high-frequency data" requirement exists to
bound.

## `GET /rides/:id/driver`

The passenger-facing read model, gated to the ride's own passenger
(404 for anyone else, same not-found-not-forbidden treatment as every
other Phase 9 endpoint). Returns `null` — not an error — both before a
driver is assigned and once the ride is over; there's nothing to *track*
in either case.

```
firstName              — the client renders an initials placeholder from
                          this itself; see "no photo pipeline" below
vehicle                — { make, model, year, color, licensePlate, ... }
location               — the driver's current position + isStale flag
                          (driver_locations, same staleness rule as Phase 6)
estimatedArrivalSeconds — via routeProvider.getRoute(driverLocation, target)
```

`target` switches at the same status boundary the passenger app's own
screens do: pickup while `DRIVER_ASSIGNED`/`DRIVER_EN_ROUTE`/`DRIVER_ARRIVED`,
destination once `PASSENGER_ONBOARD`/`IN_PROGRESS`.

**No photo pipeline.** Section 10 says "driver photo placeholder/test
photo" — there is no document/photo upload system yet (that's Phase 15's
`PROFILE_PHOTO` document type), so the API sends `firstName` only and
`DriverAvatarPlaceholder` (passenger-app) renders a colored circle with
an initial. That circle *is* the "placeholder" the spec asks for at this
stage, not a stand-in for a feature this phase is skipping.

## `GET /admin/rides/active`

Every non-terminal ride (`ACTIVE_RIDE_STATUSES`, exported from
`ridesRepository` — the same set `findActiveRideForPassenger`/`Driver`
already used), newest-first, with passenger/driver names and — for rows
with a driver assigned — their active vehicle. The vehicle lookup is a
per-row query rather than a single bigger join: at Stage 1's scale
(never more than a handful of concurrently-active rides) that's the
simpler, more maintainable trade-off over a more complex multi-table
join query.

## Client changes

**passenger-app**: `SearchingDriverScreen` now polls (`useRidePolling`,
`GET /rides/:id`, shared by all three tracking screens so there's one
poll-loop implementation instead of three near-identical copies) and
navigates to `DriverAssignedScreen` the moment the ride leaves
`SEARCHING_DRIVER`. `DriverAssignedScreen` shows the driver card
(avatar placeholder, name, vehicle, plate, ETA badge) and a mini map
(driver marker, pickup marker, a straight dashed line between them —
the same honest MOCK-route depiction the driver app uses, not real
turn-by-turn), and navigates onward to `RideTrackingScreen` once the
passenger is onboard. `RideTrackingScreen` is the same shape with the
map's target switched to the destination, navigating to
`RideCompleteScreen` (still Phase 11/13's stub) on `COMPLETED`. A
driver/system cancellation reaching either screen shows a native
`Alert` before resetting and returning to the map.

**driver-app**: `PickupNavigationScreen` and `RideScreen` each gained a
`MapView` with a driver marker, a target marker (pickup or destination),
and a dashed `Polyline` between them — drawn from this screen's own
short-lived location subscription (marker only; `DriverHomeMapScreen`,
still mounted underneath, is what actually reports position to the
server). `computeRegionForTwoPoints` (duplicated in both apps — six
lines of pure geometry, not domain logic worth sharing across two
independent app packages) keeps both points framed without an imperative
`fitToCoordinates` ref call.

**admin-app**: a new `/rides` page, linked from the dashboard, polling
`GET /admin/rides/active` on the same cadence as the Phase 6 live fleet
map. A table, not a map — "which rides are active and what stage" is a
list-shaped question; a specific ride's live driver location already has
its own dedicated view (the passenger app's tracking screens).

## Tests

`apps/api/src/routes/realtimeTracking.test.ts` — 12 integration tests
against real Postgres: route samples recorded on the first ping once
`IN_PROGRESS`, not recorded again inside the sampling interval, recorded
again once the interval has elapsed (back-dated, not waited on in real
time), not recorded at all before `IN_PROGRESS`; `actualDistanceMeters`
computed from two directly-inserted samples with an independently-
verifiable expected distance, and falling back to the pre-trip estimate
with fewer than two; `GET /rides/:id/driver` returning `null` before
assignment and after completion, populated with a real ETA once
assigned, and 404ing for a ride that isn't the caller's; `GET
/admin/rides/active` listing an active ride while excluding a completed
one, and requiring an admin role.

`packages/maps/src/haversine.test.ts` — the newly-public
`haversineDistanceMeters`: zero for identical points, ~111.19km for one
degree of latitude, symmetric, and the triangle inequality across three
points.

Full repo verification after this phase: lint, typecheck, and a clean
`rm -rf packages/*/dist apps/api/dist apps/admin-app/.next && npm run
build` all pass. 126 tests passing in `apps/api` (up from 114 before
this phase); `packages/maps` gained 4 (9 total); `apps/driver-app` and
`apps/passenger-app` each gained 3 for their new `mapRegion` pure-
geometry helper (21 and 22 total, respectively). 311 tests passing
repo-wide.

## Known limitations

- **Polling, not push**, everywhere in this phase — passenger tracking,
  driver-app's location reporting, the admin fleet map and active-rides
  list. There is no realtime transport (WebSockets/SSE) in Stage 1; every
  "realtime" surface here is a client polling on an interval, honestly
  labeled as such in every screen's own doc comment.
- **Straight-line "route," not turn-by-turn.** Both apps' maps draw a
  dashed straight line between two points — exactly what the MOCK
  `RouteProvider` actually knows (distance/duration only, no path). A
  real routing provider would need to also supply a polyline for this to
  become genuine turn-by-turn navigation.
- **No real driver photo.** `firstName` + a client-rendered initial is
  the whole "photo placeholder" for Stage 1 — see `GET /rides/:id/driver`
  above for why (no document/photo pipeline exists yet, Phase 15's job).
- **`actual_distance_meters` is still an approximation**, just a better
  one than Phase 9's — the sum of straight-line segments between
  recorded samples undercounts true road distance the same way any such
  approximation does, and the sampling interval directly trades off
  precision against exactly the "don't persist unnecessary high-
  frequency data" requirement that bounds it.
- **Admin active-rides has no map view**, only a table. Adding driver
  markers there would reuse the same `GET /admin/drivers/locations` data
  the fleet map already polls, but combining "active rides" with "live
  positions" into one view wasn't part of this phase's own ask.
