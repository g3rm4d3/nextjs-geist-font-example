# Driver App Core — Phase 5

## Scope

Phase 5 builds the driver app's foundation, independent from the
passenger app (section 2: the two must never be merged). Its one hard
requirement, stated directly in the spec, is:

> Approved drivers can OFFLINE → ONLINE. Non-approved drivers cannot.
> Support real GPS and configurable mock GPS during development.

Everything else — the full screen list — exists in the navigation IA,
functional where Phase 5's own data (driver profile, vehicle, onboarding
status) supports it, and an honest placeholder everywhere else, the same
split apps/passenger-app used in Phase 3.

## Design decision: "Go Online" / "Go Offline" are not separate screens

The spec lists "Go Online" and "Go Offline" alongside "Driver Home Map"
as if they were three screens. They're implemented here as a single
toggle button on `DriverHomeMapScreen` instead of two additional routes.
Reasoning: availability is a *state* a driver flips, not a *place* they
navigate to — there is no meaningful content that would live on a
dedicated "Go Online" screen other than the same button and status
already visible on the map. `docs/architecture.md`'s pattern of treating
the screen list as an information architecture to satisfy, not a literal
one-screen-per-bullet checklist, applies the same way here as it did to
Phase 3's `RideDraftContext` collapsing several conceptual steps into
shared state rather than separate screens.

Every other bullet in the spec's screen list has its own route: Splash,
Auth (Login + Registration combined, same reasoning as passenger's
Phase 3 `AuthScreen`), Onboarding, Vehicle, Application Status, Driver
Home Map, Documents, Incoming Request, Pickup Navigation, Arrival, Ride,
Ride Complete, Earnings, History, Profile, Support, Settings.

## The approval gate

`driver_profiles` (Phase 1) already modeled onboarding and availability
as two separate columns, with a `CHECK` constraint —
`driver_profiles_availability_requires_approval_chk` — enforcing
`availability_status = 'OFFLINE' OR onboarding_status = 'APPROVED'` at
the database level. Phase 5 adds the application layer on top:

- `PATCH /drivers/me/availability` (`apps/api/src/routes/drivers.ts`)
  accepts `{ status: 'ONLINE' | 'OFFLINE' }` — never `BUSY`, which is
  reserved for the matching/dispatch system (a later phase) to set.
- `driverService.setAvailability` (`apps/api/src/services/driverService.ts`)
  checks `onboardingStatus === 'APPROVED'` before allowing `ONLINE` and
  throws a `403 FORBIDDEN` with a clear message otherwise. Going
  `OFFLINE` is always allowed, regardless of onboarding status.
- The database `CHECK` constraint still exists underneath as the actual
  backstop — the service-layer check exists so a rejected transition
  surfaces as a clean `ApiClientError`, not a raw constraint-violation
  message reaching the client.

There is no public "approve driver" endpoint yet — driver approval is an
admin action that belongs to Phase 14. Tests and manual verification
promote a driver to `APPROVED` by writing directly to the database, the
same pattern already established for admin fixture accounts
(`authorization.test.ts`, Phase 2) and the active pricing config
(`pricing.test.ts`, Phase 4).

## Onboarding flow

A driver registers via `POST /auth/drivers/register` (Phase 2), which
creates a `driver_profiles` row with `onboardingStatus: 'DRAFT'`. From
there:

1. **Vehicle** (`PUT /drivers/me/vehicle`) — a driver has at most one
   *active* vehicle (`vehicles_one_active_per_driver_key`, a partial
   unique index from Phase 1). Submitting the form again edits that same
   row in place rather than creating a second one —
   `driversRepository.upsertVehicleForDriver` checks for an existing
   active vehicle first.
2. **Onboarding** (`POST /drivers/me/submit-application`) — moves
   `DRAFT → PENDING_REVIEW`, guarded by `driverService.submitApplication`:
   requires a vehicle to already exist (`400 VALIDATION_ERROR` otherwise)
   and requires the current status to actually be `DRAFT`
   (`409 CONFLICT` on a second submission). This is the *only* onboarding
   transition a driver can trigger themselves — `PENDING_REVIEW →
   APPROVED/REJECTED` and any `SUSPENDED` transition are admin actions
   (Phase 14).
3. **Documents** is a stub — secure document upload/review is Phase 15.
   Submitting an application does not require a document in Stage 1
   since that system doesn't exist yet.
4. **Application Status** reads the same profile and shows a
   human-readable description per status.

`GET /drivers/me/profile` is the read model all four of these screens
share (`DriverProfileSummary` — onboarding status, availability status,
vehicle-or-null). It's a separate endpoint from `GET /drivers/me`
(Phase 2, which returns the minimal `AuthUser`/`driverOnboardingStatus`
shape used for auth bootstrapping) because the driver-app's own screens
need more — a full vehicle, not just a status string.

## GPS: real and configurable mock

`src/lib/locationProvider.ts` defines one `LocationProvider` interface —
`getCurrentLocation()` and `watchLocation(onUpdate)` — with two
implementations, selected by `env.mockGpsEnabled`
(`EXPO_PUBLIC_MOCK_GPS`):

- **`createExpoLocationProvider`** — real GPS via `expo-location`,
  requesting foreground permission and using `watchPositionAsync` for
  ongoing updates. This is what a real device or simulator with a
  location fix uses.
- **`createMockLocationProvider`** — no `expo-location` call at all.
  Resolves immediately with a configured coordinate
  (`EXPO_PUBLIC_MOCK_GPS_LAT`/`_LNG`, defaulting to the same fallback
  point `apps/passenger-app` uses) and drifts it slightly on a 4-second
  tick so a driver watching their own marker on `DriverHomeMapScreen`
  sees it actually move, rather than a suspiciously frozen pin.

This environment has no simulator or device with a usable GPS fix, so
`.env.example` ships with `EXPO_PUBLIC_MOCK_GPS=true` — mock mode is
what's actually exercised here. A real device/simulator build sets it to
`false` (or leaves it unset) to use real GPS instead. Both code paths are
covered by `locationProvider.test.ts` (mock mode, using fake timers to
verify the drift-and-unsubscribe behavior) — the real-GPS path isn't
independently testable under Jest for the same reason
`apps/passenger-app`'s `HomeMapScreen` GPS code isn't (no RN component-
rendering tests in this environment; see `docs/maps.md`).

**Nothing here sends this position to the server.** Phase 5 only proves
the app can read a position (real or mock) and display it. Streaming a
driver's live location to the backend — the thing a real dispatch system
would need — is Phase 6 (Location Infrastructure), not this one.

## Screens

| Screen | Status | Notes |
|---|---|---|
| Splash | Functional | Shown while `AuthContext` resolves a stored session |
| Auth | Functional | Combined login/register; register collects license number + state |
| Onboarding | Functional | Checklist: add vehicle → submit application |
| Vehicle | Functional | Single form; upserts the driver's one active vehicle |
| Application Status | Functional | Reads `DriverProfileSummary`, shows status + vehicle summary |
| Driver Home Map | Functional | Map + live position (real/mock GPS) + availability toggle |
| Documents | Stub | Phase 15 |
| Incoming Request | Stub | Phase 8 (matching/dispatch) |
| Pickup Navigation | Stub | Phase 9/10 |
| Arrival | Stub | Phase 9 |
| Ride | Stub | Phase 9/10 |
| Ride Complete | Stub | Phase 9/12/13 |
| Earnings | Stub | Phase 12 |
| History | Stub | Phase 7 |
| Profile | Functional | User info + menu + logout, mirrors passenger app's `ProfileScreen` |
| Support | Stub | Phase 18 |
| Settings | Stub | No phase introduces anything to configure yet |

## Shared state

`DriverProfileContext` (mirrors `RideDraftContext` from Phase 3) holds
the driver's `DriverProfileSummary` for the whole authenticated part of
the app, fetched once on sign-in via `GET /drivers/me/profile`. Screens
that mutate it (Vehicle, Onboarding, the availability toggle) call
`setProfile(...)` directly from the mutation's response instead of
re-fetching, so every screen sees the new status immediately.

## Tests

- `apps/api/src/routes/drivers.test.ts` — 14 tests against real
  Postgres: profile read model, vehicle create/update-in-place/validation/
  role-gating, application submission (no-vehicle rejection, DRAFT →
  PENDING_REVIEW, rejecting a second submission), and availability
  (redundant OFFLINE always allowed, ONLINE blocked pre-approval,
  ONLINE/OFFLINE both allowed once APPROVED, invalid status value,
  unauthenticated). Run twice for repeatability (61/61 API tests both
  times).
- `packages/validation/src/driver.test.ts` — `updateAvailabilitySchema`
  (rejects `BUSY` and unknown values) and `upsertVehicleSchema`
  (year/seats bounds, required fields).
- `packages/types/src/index.test.ts` — `DriverProfileSummary` shape,
  with and without a vehicle.
- `apps/driver-app/src/lib/apiClient.test.ts`,
  `src/config/env.test.ts`, `src/lib/locationProvider.test.ts` — same
  fetch-mocking and module-re-require patterns established in
  `apps/passenger-app`.
- Manual smoke test against a live seeded Postgres confirmed the full
  flow: register (DRAFT, no vehicle) → add vehicle → attempt ONLINE
  (403 FORBIDDEN) → submit application (PENDING_REVIEW) → approve via
  direct DB update → go ONLINE (200) → go OFFLINE (200).

## Known limitations

- No admin approval endpoint yet — driver approval is entirely a direct
  database operation until Phase 14.
- No document upload — Documents is a stub until Phase 15.
- Driver location is read and displayed locally only; it is never sent
  to the server until Phase 6.
- `BUSY` (mid-ride) is modeled in the database and the shared types but
  has no code path that sets it yet — that's the matching/dispatch
  system, not built until Phase 8+.
- As with `apps/passenger-app`, there are no React Native component-
  rendering tests in this environment; validation is typecheck + lint +
  a successful Metro bundle export (`expo export --platform android`,
  893 modules, no import errors) plus the backend's real-Postgres tests
  and a manual curl-based smoke test.
