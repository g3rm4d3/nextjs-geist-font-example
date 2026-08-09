# Location Infrastructure — Phase 6

## Payload and validation

A driver location ping is `{ latitude, longitude, heading?, speed?, accuracy?, timestamp? }`
(`@rideshare/validation`'s `driverLocationPingSchema`, `@rideshare/types`'s
`DriverLocationPing`) — exactly the spec's list. Only latitude/longitude
are required; heading, speed, accuracy, and timestamp are all optional,
since a real GPS fix doesn't always carry all of them (a coarse
network-based fix might have no heading/speed at all). Coordinates reuse
the same `[-90, 90]`/`[-180, 180]` bounds as every other lat/lng in this
project (`coordinateSchema`); heading is bounded `[0, 360]`, speed and
accuracy are non-negative.

## Storage: separating realtime delivery from long-term persistence

`driver_locations` (Phase 1's schema) is one row per driver, upserted in
place on every ping via `ON CONFLICT (driver_id) DO UPDATE`
(`locationsRepository.upsertDriverLocation`). This is the "high-frequency
realtime delivery" side of section 6's split: no matter how often — or
how many — drivers ping, this table's size never grows past one row per
driver. It answers "where is this driver *right now*", nothing else.

`ride_location_samples` (also already in the Phase 1 schema, but not
touched by this phase) is the other half of that split — a breadcrumb
trail of historical samples *during a specific ride*, append-only rather
than overwrite-in-place. It stays unused until Phase 10 (Realtime Ride
Experience), which is the first phase with rides to attach samples to.
Building the ingest pipeline for "current position" now, with the
historical-trail table already reserved and untouched, is what "separate
... when appropriate" means here: the two concerns get separate tables
today, even though only one of them has a writer yet.

## Handling the spec's five edge cases

| Case | Where it's handled |
|---|---|
| **Invalid coordinates** | `driverLocationPingSchema` (400 before the request reaches a service) and the database's own `driver_locations_lat_range_chk`/`lng_range_chk` CHECK constraints underneath it. |
| **Stale GPS** | Never rejected — a location ping's `timestamp` can be arbitrarily old and is still stored. `locationService` computes `isStale` (`recordedAt` older than `STALE_THRESHOLD_MS` = 2 minutes) *at read time*, on every row returned to a caller (the admin map today; a later phase's "recent valid location" matching-eligibility check tomorrow — section 8's own wording). A location is a fact about the past; staleness is a property of *now*, not of when it was written, so it can't be baked in at write time. |
| **Missing permissions** | Client-side only (there's nothing for the server to validate about a permission it never sees) — `apps/driver-app`'s `locationProvider.getCurrentLocation()` returns `permission: 'denied'` when `expo-location` reports no grant, and `DriverHomeMapScreen` uses that flag to both show a banner and stop sending pings (`shouldReport` requires `permission === 'granted'`). |
| **Network interruption** | The client's ping is fire-and-forget (`reportLocation(...).catch(() => undefined)`); a dropped request is simply the next watch tick's problem, not a queue to retry or reconcile — a live position stream self-heals every few seconds by construction, so nothing more elaborate is needed at Stage 1. |
| **Background/foreground transitions** | `DriverHomeMapScreen` checks `AppState.currentState === 'active'` at send time before every ping — backgrounded, the GPS watch keeps running quietly (so a resumed foreground has an immediately fresh position) but nothing is sent to the server while backgrounded. |

## Avoiding excessive database writes

Three independent layers, each answering a different question:

1. **Storage shape** — `driver_locations`'s upsert-in-place design (above)
   means write *volume* never translates into unbounded storage growth,
   regardless of ping frequency.
2. **`locationService`'s minimum write interval** (`MIN_WRITE_INTERVAL_MS`
   = 2s) — a ping that arrives faster than this after the last *persisted*
   write for that driver still returns `200` (the client never needs its
   own throttling or special-case error handling), but the database
   write is skipped. The response's `written: false` and the returned
   `location` reflecting the previously-stored ping, not the just-received
   one, make this observable — see `location.test.ts`'s
   "skips the write when pings arrive faster than the minimum interval".
3. **`locationPingLimiter`** (60/minute) — the outer backstop against a
   client (or bug) hammering the endpoint outright, independent of
   whether individual pings would pass the interval check.

Layer 3 exposed a real bug during this phase's own testing, described
next.

## A bug the 50-driver simulator caught: rate limiting must key by driver, not IP

Every other rate limiter in this codebase (`loginLimiter`,
`registerLimiter`, ...) keys by IP — the right dimension for "stop one
source from creating/guessing lots of accounts". `locationPingLimiter`
was originally built the same way. Running the simulator against a real
local server immediately broke: 50 virtual drivers behind the same
`127.0.0.1` shared one IP-keyed counter, so after roughly the first
second of ticks, most drivers' pings started returning `429`.

This isn't just a local-dev artifact — IP is the *wrong* dimension for a
per-driver operational cadence limit like this one:

- Real driver phones on cellular networks routinely share one carrier-
  grade NAT IP with many other unrelated devices. An IP-keyed limiter
  would throttle drivers who have nothing to do with each other.
- This endpoint always sits behind `requireAuth`, so a stable per-request
  identity (`req.auth.userId`) is already available and is the actual
  thing being rate-limited: *this driver's* ping cadence.

Fixed by keying `locationPingLimiter` on `req.auth.userId` instead
(`locationPingKeyGenerator`, `middleware/rateLimit.ts`), with IP kept
only as a fallback for the (should-never-happen) case of a missing
`req.auth`. Re-running the simulator at full scale after the fix: 50/50
pings succeeded on every tick. `rateLimit.test.ts` covers the key
generator directly (two drivers, same IP, two independent keys) since
exercising the real 60/minute threshold in an automated test isn't
practical (the test-mode `×1000` multiplier that keeps other limiters
from interfering with test runs would require tens of thousands of
requests to trip).

## Driver app: sending pings

`apps/driver-app/src/lib/locationProvider.ts` (Phase 5) now emits a
`LocationSample` — `Coordinate` plus optional `heading`/`speed`/`accuracy`
and a required `timestamp` — from both `getCurrentLocation()` and
`watchLocation()`, instead of a bare coordinate. Real GPS pulls these
straight from `expo-location`'s position object; mock mode (still the
only mode actually exercised in this environment — see Phase 5's
`docs/driver-app.md`) fabricates a plausible heading/speed each tick so a
simulated "driver" looks like it's actually moving, not just teleporting.

`DriverHomeMapScreen` subscribes to that same long-lived `watchLocation`
call it already used for the map marker (Phase 5), and now also reports
each sample to `POST /drivers/me/location` — but only when
`isOnlineRef`/`permissionRef`/`accessTokenRef` (refs, so the long-lived
watch callback reads current values instead of closing over stale ones
from when it was set up) and `AppState.currentState` all say it should.
Going OFFLINE, losing permission, or backgrounding the app all silently
stop pings without tearing down and re-subscribing to GPS.

## The 50-driver simulator

`apps/api/scripts/locationSimulator.ts` (`npm run simulate:drivers`, or
from the repo root `npm run simulate:drivers`) is the spec's "simulator
capable of moving 50 virtual drivers". It drives the *real* HTTP
location/availability surface — `PATCH /drivers/me/availability` and
`POST /drivers/me/location` — so it exercises the same validation,
staleness, and throttling code paths a real driver app does.

Driver **identities** are created directly in the database
(`users` + `driver_profiles`, already `APPROVED`) and their access tokens
are signed directly with `signAccessToken()` — deliberately bypassing
`POST /auth/drivers/register` and `POST /auth/login`. This isn't a
shortcut of convenience: `registerLimiter` (10/hour) and `loginLimiter`
(20/15min) exist specifically to stop a burst of account creation/login
from one source, and spinning up 50 drivers at once *is* exactly that
burst. Routing the simulator through those endpoints was tried first and
either fails outright or would require weakening real anti-abuse limits
— both wrong. Registration and login already have dedicated tests
(Phase 2); this tool's job is location-ingest at scale, so it goes
straight to the identities and only exercises the two endpoints Phase 6
is actually about.

Configurable via env vars (`SIMULATOR_API_URL`, `SIMULATOR_DRIVER_COUNT`,
`SIMULATOR_TICK_MS`, `SIMULATOR_DURATION_MS`; `0` duration runs until
Ctrl+C). Each driver spawns scattered around the same fictional city
center the seed data and both mobile apps' mock-GPS fallback use, then
random-walks from there. Verified at full scale (50 drivers, several
ticks): 50/50 pings succeeded on every tick, and `driver_locations`
never grew past one row per driver (confirmed directly against Postgres)
regardless of tick count.

## Admin App: live fleet map

`GET /admin/drivers/locations` (`requireRole('ADMIN', 'SUPER_ADMIN')`)
returns every driver with a location on file — not filtered to `ONLINE`
only, since an admin investigating "why isn't this driver showing up"
needs to see a stale/offline last-known position too, not have it
silently excluded.

Consuming it needed *some* admin authentication, which didn't exist yet
(Admin App is still Phase 0's bare scaffold; the full build-out is
Phase 14). Added the minimum to unblock this phase's own requirement:

- `AdminAuthProvider` — login against the existing `POST /auth/login`,
  client-side-checks the returned role is `ADMIN`/`SUPER_ADMIN` (a UX
  nicety only — the server's `requireRole` on the actual endpoint is the
  real boundary regardless of what this check believes), stores the
  token in `localStorage`. A production admin console would want
  httpOnly cookies + CSRF protection instead of client-readable storage;
  deferred to Phase 14 along with the rest of Admin App hardening, in
  keeping with Stage 1's "development and technical validation, not
  commercial launch" scope.
- `/login` — email/password form. No self-service admin registration
  exists (section 8) or ever will through this app; accounts are
  provisioned directly against the database, same as every admin fixture
  in this project's own tests, or via `packages/database/src/seed.ts`'s
  `SEED_ADMIN_PASSWORD`-gated fixture.
- `/live-map` — polls `GET /admin/drivers/locations` every 4 seconds and
  renders markers with `react-leaflet` over OpenStreetMap tiles (free,
  no API key to provision — unlike the mobile apps' Android Google Maps
  key gap documented in `docs/maps.md`). Marker color encodes state:
  green (`ONLINE`), amber (`BUSY`), slate (`OFFLINE`), gray (`isStale`).
  Leaflet's default marker *image* asset resolution famously breaks
  under bundlers, so markers use a plain `L.divIcon` colored dot instead
  of the default icon — sidesteps the whole asset-path problem.
  Rendering is deferred to the client only (`next/dynamic` with
  `ssr: false`) since Leaflet touches `window` at import time and would
  otherwise break server rendering.

Verified with a real browser (Playwright + the pre-installed Chromium):
logged in, redirected to `/live-map`, and confirmed markers rendered for
every driver the simulator had created — 170 markers matching the
accumulated count from this phase's own test runs, screenshotted for the
record. Base-map *tile images* didn't load in that check — this sandbox's
outbound network policy blocks the OpenStreetMap tile host — but the
markers themselves (driven entirely by `GET /admin/drivers/locations`,
not the tile server) rendered correctly at the right positions, which is
what actually matters here: the tile layer is a visual backdrop, not
something this feature's correctness depends on.

## Tests

- `apps/api/src/routes/location.test.ts` — 11 tests against real
  Postgres: a full ping round-trip with every field populated, a
  minimal (coordinates-only) ping, the write-throttle skip behavior, an
  old-but-valid timestamp flagged `isStale` without being rejected, a
  too-far-future timestamp rejected outright, invalid coordinates,
  role/auth gating, and the admin fleet endpoint's shape/role/auth
  gating.
- `apps/api/src/middleware/rateLimit.test.ts` — the per-driver key
  generator, direct regression coverage for the bug above.
- `packages/validation/src/location.test.ts`,
  `packages/types/src/index.test.ts` (extended) — schema and shape
  tests.
- `apps/driver-app`: `locationProvider.test.ts` extended for the richer
  `LocationSample` shape (heading/speed/accuracy/timestamp all present
  and plausible in mock mode); `apiClient.test.ts` extended for
  `reportLocation`.
- `apps/admin-app`: `apiClient.test.ts` (new) for `login`/`getMe`/
  `getFleetLocations`.
- Manual/integration verification: the 50-driver simulator at full scale
  against a live server (50/50 pings on every tick; exactly one
  `driver_locations` row per driver confirmed via `psql`), and the
  Playwright browser check of the full admin login → live map flow
  described above.

## Known limitations

- No realtime transport (WebSockets/SSE) yet — the admin map polls on an
  interval, and there's no push channel to a driver or passenger client
  either. That's Phase 10.
- Driver location is never attached to a specific ride
  (`ride_location_samples` stays empty) — there are no rides to attach
  it to until Phase 7+.
- The client's "network interruption" handling is deliberately minimal
  (fire-and-forget, no retry queue) — appropriate for a live position
  stream that self-heals every few seconds, not necessarily for every
  future use of this pattern.
- `AdminAuthContext` stores its token in `localStorage`, not an httpOnly
  cookie — acceptable for Stage 1's own manual testing, not for a real
  deployment (see above).
- This sandbox's network policy blocks the OpenStreetMap tile host, so
  the live map's tile *imagery* can't be visually verified from inside
  this environment, only its marker data (which is the part this
  phase's code is actually responsible for).
