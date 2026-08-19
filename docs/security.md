# Security Review — Phase 20

## Scope and method

Section 20: "Perform application security review" across authentication,
authorization, IDOR, role escalation, input validation, rate limiting,
database policies, SQL injection exposure, XSS, CSRF where applicable,
file uploads, secret handling, webhooks, payment manipulation, fare
manipulation, duplicate payments, duplicate rides, location manipulation,
admin endpoints, and logging of sensitive data — fix critical/high-risk
findings within scope, document remaining risks honestly.

This was a manual code review of the entire application (every route
file, every service, every validation schema, every rate limiter) rather
than an automated scanner pass — the codebase is small enough (apps/api's
`routes/`/`services/` directories) for that to be more precise than a
generic tool would be, and it's what surfaced the three real, fixable
findings below rather than a list of framework-generic boilerplate
advice. Every claim in this document is backed by a specific file/line a
reviewer can re-check, not a general assurance.

## What this review is not

Stage 1 is explicitly "development and technical validation only" (see
the top of this repo's spec) — no real users, no real payments (Stripe
TEST MODE only, live keys hard-rejected at startup — see docs/payments.md
and packages/payments/src/stripePaymentProvider.ts), no real background
checks (packages/screening is a MOCK abstraction with no PII fields at
all). This review evaluates the application's own code against realistic
threats to *that* system, not a hypothetical production deployment with
real money and real riders — some of the "remaining risks" below are
explicitly things that would need to change before this codebase could
ever be pointed at production traffic, and are called out as such rather
than glossed over.

## Findings fixed in this phase

### 1. Rate-limiting coverage gaps (medium)

`apps/api/src/middleware/rateLimit.ts` has a dedicated limiter for
essentially every route added from Phase 7 onward — but a sweep of every
route file (grepping every `router.get/post/patch/put/delete` call
against every named `*Limiter` middleware) found **twelve routes with no
rate limiter at all**, every one of them a leftover from before this
module existed (Phase 2/3/5):

- `POST /auth/refresh`, `POST /auth/logout` — no prior access-token
  session, no rate limit of any kind (not even IP-based, unlike
  `loginLimiter`/`registerLimiter`). Refresh tokens are 384-bit random
  values (`generateRefreshToken`), so brute force is computationally
  infeasible regardless — the real risk was DoS/resource-exhaustion
  potential and plain inconsistency with the app's own established
  posture.
- `GET /auth/me`, `GET /drivers/me`, `GET /drivers/me/profile`,
  `PUT /drivers/me/vehicle`, `POST /drivers/me/submit-application`,
  `PATCH /drivers/me/availability`, `GET /passengers/me` — basic,
  authenticated "my own profile" endpoints, two of them state-changing
  writes, with zero throttling.
- `GET /admin/users`, `GET /admin/drivers/locations`,
  `GET /admin/rides/active` — the three original Phase 2/6/10 admin
  endpoints in `routes/admin.ts`, never retrofitted with `adminLimiter`
  when every *other* admin route file picked it up in Phase 14.

None of these are exploitable for privilege escalation or data leakage
(every one of them still requires the correct role, and IDOR is a
separate, clean finding below) — this is squarely a defense-in-depth /
consistency gap, not an auth bypass. Fixed by:

- A new `refreshLimiter` (IP-keyed, 30/15min, same shape as
  `loginLimiter`) on `/auth/refresh` and `/auth/logout`.
- A new `profileLimiter` (per-user, 30/min, same shape as
  `documentLimiter`/`paymentLimiter`) on all seven `/auth/me`,
  `/drivers/me*`, `/passengers/me` routes above.
- The existing `adminLimiter` added to the three `routes/admin.ts`
  routes, matching every other admin route file's own convention.

### 2. Unrestricted document `contentType` (low, hardened defensively)

`uploadDocumentSchema` (Phase 15) validated `contentBase64`'s shape and
size but accepted `contentType` as any string up to 100 characters.
`packages/storage`'s `mockStorageProvider.getUrl()` returns
`data:${contentType};base64,${contentBase64}` — reflecting that
client-supplied value verbatim into a data URI. Had any client (admin-app
or driver-app) ever called `getUrl()` to render/link a stored document,
an attacker-controlled `contentType` like `text/html` could turn an
uploaded "document" into a `data:text/html` payload — a content-type
confusion / stored-content risk.

**Not currently exploitable**: a repo-wide search confirms `getUrl()` is
never called anywhere in the running application today — Phase 15 built
upload + admin review/expiration-warning flows, never a "view the actual
file" feature. Fixed anyway, since it's a one-line, zero-risk hardening:
`contentType` is now a Zod enum restricted to
`image/jpeg | image/png | image/webp | application/pdf` — the only real
shapes a photographed license/registration/insurance page or profile
photo can legitimately be. This can never regress into the *data:*-URI
risk once a future phase does add a document-viewing feature.

### 3. Fare/earnings manipulation via spoofed location samples (medium)

`rideLifecycleService.computeActualDistanceMeters` sums the haversine
distance between consecutive `ride_location_samples` rows recorded
during an `IN_PROGRESS` ride — samples that are entirely self-reported by
the driver's own device via `POST /drivers/me/location` (Phase 10),
with no way to cryptographically verify a real GPS fix. That sum feeds
directly into `getFareForActualTrip` → `finalFareCents`, which is both
what the passenger is auto-charged (`chargeRideFare`) and what the
driver's own earnings ledger records (`recordEarningsForCompletedRide`)
— the same number, from the exact same computation, both directions.

This is a real, incentive-aligned attack: a driver profits directly by
reporting a longer route than actually driven (a much more direct
motive than the more commonly-discussed "spoof to win more ride
offers" location-manipulation concern, which this app doesn't attempt to
solve either — see Known Limitations). There was no upper bound at all
on the GPS-derived distance versus the pre-trip estimate.

**Fixed** with a sanity bound, not a fraud-detection system (a full
anti-spoofing pipeline is genuinely out of scope for what a targeted fix
belongs doing): `computeActualDistanceMeters` now caps the GPS-derived
distance at `max(estimatedDistanceMeters × 3, 5,000m)` — generous enough
that a real detour, a wrong turn, or heavy traffic rerouting is never
clipped (verified against the existing
`realtimeTracking.test.ts` coverage, whose synthetic 2-sample scenario
sits at roughly 1× the estimate, well under the cap), while ruling out
gross inflation (10x, 100x). A capped ride logs a `logger.warn` with the
computed vs. capped values so an operator reviewing logs can see it
happened. This does not defend against small-scale (within-3x) spoofing
— see Known Limitations.

## Reviewed and found solid — no changes needed

### Authentication

- Passwords: bcrypt, cost factor 12, explicit rejection (not silent
  truncation) of inputs over bcrypt's 72-byte limit
  (`packages/auth/src/password.ts`).
- Login: identical code path and an extra dummy `bcrypt.compare` call
  whether the account doesn't exist or the password is wrong, plus an
  identical generic error message either way — a deliberate
  user-enumeration/timing-attack mitigation
  (`authService.ts`'s `DUMMY_BCRYPT_HASH`).
- Access tokens: short-lived JWT (HS256, 15m default), signed with a
  secret the env schema requires to be ≥32 characters. Refresh tokens:
  opaque 384-bit random values, stored only as a SHA-256 hash — a
  database leak of the `sessions` table yields nothing directly usable.
- Refresh rotation + reuse detection: every `/auth/refresh` call revokes
  the token just used and issues a new pair; presenting an
  already-revoked refresh token revokes *every* session for that user
  defensively (stolen-token-reuse scenario).
- Password reset: single-use, time-limited, opaque token (same hashing
  as refresh tokens); the request endpoint always returns the same
  success shape regardless of whether the email exists (no enumeration
  oracle); confirming a reset revokes every session for that user.
- Role escalation: `registerPassengerSchema`/`registerDriverSchema` have
  no `role` field at all — the role is a hardcoded literal
  (`'PASSENGER'`/`'DRIVER'`) in `usersRepository.createPassenger`/
  `createDriver`, never derived from client input. No code path anywhere
  in the application writes to `users.role` after insert. There is no
  public path to an `ADMIN`/`SUPER_ADMIN` account; those are seeded
  out-of-band (`packages/database/src/seed.ts`).
- Secrets: `.env` is gitignored and was never committed
  (`git ls-files` confirms); `.env.example` contains only placeholders
  that fail the schema's own length check if used as-is. Stripe secret
  keys are hard-rejected unless prefixed `sk_test_` — a live key throws
  at provider construction time, before any request can use it
  (`packages/payments/src/stripePaymentProvider.ts`).
- Logging: `packages/logging` configures pino's `redact` for
  `password`/`token`/`accessToken`/`refreshToken`/`authorization` (and
  the `req.headers.authorization`/`req.headers.cookie` paths pino-http's
  own default request serializer would otherwise include) plus
  `cardNumber`/`cvv`/`secret`/`apiKey`, with a dedicated test asserting
  it. Verified against an actual captured request log from this
  session's own Phase 19 run — every `authorization` line reads
  `"[REDACTED]"`. A repo-wide grep of every `logger.*()` call found none
  that pass a raw request body, full DB row, password, or token value.

**One deliberate, already-documented architectural tradeoff, reaffirmed
here rather than re-litigated**: `requireAuth` never re-queries the
database per request (that's the entire point of a stateless JWT) — a
suspended/deactivated account's already-issued access token stays valid
until its natural expiry (bounded by `JWT_ACCESS_TOKEN_TTL`, 15 minutes
by default) or until a refresh attempt, which *does* check `isActive`.
For the one place this actually matters today (a suspended driver), the
sensitive action itself (going `ONLINE`) is independently re-gated on
`onboardingStatus === 'APPROVED'` at the service layer
(`driverService.setAvailability`) and by a database check constraint
(`driver_profiles_availability_requires_approval_chk`) — a suspended
driver's still-valid access token cannot be used to go online regardless.
See docs/authentication.md's own "nothing server-side can revoke an
individual access token before it expires" note.

### Authorization, IDOR, role escalation

Every one of the 85 route definitions in `apps/api/src/routes/*.ts` was
enumerated and checked:

- **76 require `requireAuth`.** The remaining 9 are exactly the
  intentionally-public set: both register endpoints, login, refresh,
  logout, both password-reset endpoints, `/health`, and the Stripe
  webhook (which authenticates via signature, not a session).
- **Every admin route requires `requireRole('ADMIN', 'SUPER_ADMIN')` or
  `requireRole('SUPER_ADMIN')`**, with the SUPER_ADMIN-only set matching
  the established "routine/reversible = ADMIN+; severe/platform-wide =
  SUPER_ADMIN only" convention exactly: driver suspend/reactivate,
  pricing config writes, settings writes, and audit-log reading.
- **Every resource fetched by a client-supplied id enforces ownership at
  the point of the actual read/write, not just in a comment.** Spot-
  checked across every domain: `rideLifecycleService.getRideForUser` /
  `driverTransition` (rides), `paymentService.getPaymentForRide`,
  `ratingsService.getRatingsForRide`, `notificationsRepository.
  markNotificationRead`/`deletePushToken`, `driverService.upsertVehicle`
  (never accepts a vehicle id from the client at all — always derives it
  server-side from the authenticated driver), and Phase 18's support
  tickets (reviewed in that phase). The pattern is consistent
  everywhere: a resource that exists but belongs to someone else returns
  `404`, never `403` (never confirms existence to a caller who
  shouldn't see it) — and where the compare-and-swap primitive matters
  (ride lifecycle transitions), ownership is baked into the same atomic
  `UPDATE ... WHERE` as the state check, not just a pre-read.
- The only 3 authenticated routes with no `requireRole` at all
  (`GET /auth/me`, `POST /pricing/estimate`, `POST /routes/preview`) are
  legitimately role-agnostic — any signed-in user, regardless of role,
  is allowed to do these.

### Input validation, SQL injection, XSS, CSRF

- Every mutating route either validates its body against a Zod schema
  via `validateBody` or genuinely takes no body (action-only endpoints
  like accept/decline/lifecycle transitions/mark-read, where the action
  is implicit in the URL) — enumerated exhaustively, zero gaps.
  `validateBody` replaces `req.body` with the *parsed* result
  (`req.body = result.data`), so Zod's default unknown-key-stripping
  behavior is a real mass-assignment defense, not just a paper one (the
  existing "strips an unexpected fare field rather than accepting it"
  test in `packages/validation/src/ride.test.ts` demonstrates this).
- Every GET route that reads `req.query` (document review-status/
  expiring-days filters, payment/ride status filters, the push-token
  unregister endpoint) explicitly type-checks and constrains the value
  before use, rejecting anything malformed with a `ValidationError`.
- **SQL injection: no exposure found.** The entire application queries
  through Drizzle ORM's query builder. The only three places raw
  `sql\`...\`` fragments appear in `apps/api/src` interpolate either a
  schema column reference or a `Date` — never a raw string — which
  Drizzle's tagged template always binds as a parameter, never
  concatenates. `sql.raw()` appears exactly once in the whole repo,
  in the Phase 19 dev-only load simulator, against fixed literal
  `EXPLAIN` text with no user input. `pool.query()` with a literal string
  appears only in the health check and dev-only `db:reset`/test-teardown
  scripts, never with interpolated user input.
- **XSS: no exposure found.** `dangerouslySetInnerHTML`, `WebView`,
  `eval`, and `new Function` appear nowhere across admin-app,
  passenger-app, or driver-app. admin-app is Next.js/React, which
  escapes all `{value}` JSX expressions by default — every user-supplied
  string it renders (support messages, ride addresses, driver/passenger
  names) goes through that default escaping.
- **CSRF: not applicable.** Every client (admin-app, passenger-app,
  driver-app) authenticates with a bearer token in the `Authorization`
  header — never a cookie. CSRF's entire premise (a browser
  automatically attaching ambient credentials to a cross-origin request)
  doesn't apply when there's no ambient credential to attach. See
  Known Limitations for the tradeoff this choice makes on the admin-app
  side specifically.

### Rate limiting, database policies, webhooks

- Beyond the three fixed gaps above, every other route (77 of them) is
  behind an appropriately-scoped limiter — IP-keyed for
  pre-authentication endpoints (login, register, password reset,
  webhooks), per-identity for everything behind `requireAuth` (the
  correct dimension per `locationPingLimiter`'s own documented reasoning
  — many drivers can legitimately share one IP on cellular carrier-grade
  NAT).
- Database-level constraints back the application layer everywhere money
  or coordinates are involved: 38 `check`/`unique` constraints across the
  schema (non-negative money on every fare/earnings/payment column,
  latitude/longitude range checks on both `driver_locations` and
  `ride_location_samples`, the one-active-ride-per-passenger and
  idempotency-key uniqueness constraints, license/VIN/plate uniqueness).
  These are the actual guarantee; the service-layer checks in front of
  them are the friendly error message, not the enforcement — the
  established pattern throughout every phase's own documentation.
- Webhook signature verification (`POST /webhooks/stripe`) uses the real
  Stripe SDK's `stripe.webhooks.constructEvent` (shared by both the MOCK
  and real `PaymentProvider` — one verification code path, not two to
  keep in sync), which does a timing-safe HMAC comparison internally. An
  unconfigured `STRIPE_WEBHOOK_SECRET` makes the route reject every
  delivery outright (`throw`, not "skip verification") — there is no
  insecure fallback. Idempotency is by compare-and-swap on
  `providerPaymentIntentId` + status (`PENDING` only), not by
  event-id deduplication — idempotent against *any* redelivery, not just
  literal duplicate event ids. Verified under real duplicate delivery in
  Phase 19's actual load-test run (`docs/simulation-results.md`), not
  just by code inspection.

### File uploads, payment/fare manipulation, duplicate payments, duplicate rides

- Document upload storage keys are always `${keyPrefix}/${randomUUID()}`
  where `keyPrefix` comes from a fixed lookup table keyed by the
  validated `documentType` enum — never client-controlled text — so
  there is no path-traversal surface in the storage key itself.
- **No validation schema anywhere in the application accepts a
  client-supplied money field.** A repo-wide search of every Zod schema
  in `packages/validation` for `amountCents`/`fareCents`/
  `finalFareCents`-shaped fields returns nothing — every fare and
  payment amount in the system is computed server-side
  (`pricingService`/`getFareForActualTrip`) from data the server itself
  derived (route distance via `RouteProvider`, not a client-supplied
  number), never accepted as input. This is section 3's
  server-authoritative principle applied with zero exceptions found.
- Duplicate rides: idempotency-key + one-active-ride-per-passenger,
  enforced at both the service layer (a friendly pre-check) and the
  database (`rides_passenger_idempotency_key_key`,
  `rides_one_active_per_passenger_key` — the actual guarantee under a
  race). Verified under real duplicate-request load in Phase 19's
  simulator, not just unit-tested.
- Duplicate payments: `payment_records` compare-and-swap only transitions
  a genuinely `PENDING` row; a redelivered/duplicate webhook or a
  retried charge attempt against an already-`SUCCEEDED` record is a
  no-op by construction, not by a special-cased duplicate check.

### Admin endpoints, sensitive-data logging

- Every mutating admin service function calls the shared audit-log
  recorder; every admin service function that doesn't is a pure
  read (list/detail getter) — enumerated exhaustively across all twelve
  `services/admin*.ts` files, zero unaudited mutations found.
- No SSN, date-of-birth, or other sensitive-PII field exists anywhere in
  the schema — `packages/screening`'s background-check abstraction was
  deliberately built (Phase 15) with no such fields, consistent with
  Stage 1's explicit "no real background checks" constraint.
- `GET /admin/users` returns an explicit narrow `AdminUserSummary` shape
  (`id`/`email`/`role`/`isActive`/`createdAt`) — `passwordHash` is never
  in the query projection, let alone the response.

## Known limitations / remaining risks (documented, not fixed)

Honest by design, per this phase's own instruction — these are real
characteristics of the current system, not oversights being hidden:

- **GPS coordinates are inherently client-self-reported.** Nothing can
  cryptographically verify a real GPS fix from a mobile device. Beyond
  the fare-manipulation vector fixed above (§3), a driver could still
  report a false *current* position to game which ride offers they
  receive (appearing closer to a pickup than they really are) — this
  app makes no attempt to detect that, and no production rideshare
  system fully solves it either (it's normally addressed with layered
  fraud-detection heuristics, not a single check). Coordinate *validity*
  (in-range lat/lng) is enforced everywhere; coordinate *truthfulness*
  is not, and isn't practically achievable at this scope.
- **The distance-inflation fix (§3) is a sanity bound, not fraud
  detection.** A driver who inflates distance by *less* than 3× the
  estimate (or stays under the 5km floor) is not caught by it. A real
  system would pair this with anomaly scoring across many rides, driver
  reputation, and possibly server-side route matching against the
  reported samples — meaningfully more than a single-ride check.
- **No passenger account suspension/deactivation capability exists.**
  Phase 14 built driver moderation (approve/reject/suspend/reactivate)
  because drivers have an onboarding lifecycle to moderate; passengers
  never got an equivalent "disable this account" admin action. `users.
  isActive` can currently only be set to `false` directly in the
  database (or by a test). This is a functional gap for an eventual
  trust-and-safety feature, not a vulnerability in what exists today.
- **admin-app stores its access token in `localStorage`, not an httpOnly
  cookie.** This was a deliberate, self-documented Phase 3/14 tradeoff
  (see `AdminAuthContext.tsx`'s own comment) mirroring the mobile apps'
  token-in-client-storage pattern, since the browser has no equivalent
  of `expo-secure-store`. The tradeoff this makes: CSRF becomes
  structurally inapplicable (the upside, documented above), but a
  successful XSS would be able to read the token directly rather than
  being blocked by `httpOnly`. This review found zero XSS surface today
  (no `dangerouslySetInnerHTML`/`eval`/etc. anywhere), so the practical
  risk is low, but it's a real "would want httpOnly cookies + CSRF
  protection instead" item for any future production hardening pass —
  a genuine rearchitecture (session cookie issuance, CSRF token
  middleware, `SameSite` policy), not something this phase attempted as
  a targeted fix.
- **The dev/CI database connection uses the Postgres superuser role**
  (`postgres:postgres` in `DATABASE_URL`), not a dedicated
  least-privilege application role. Given the confirmed absence of any
  SQL-injection surface, this doesn't translate into an exploitable
  vulnerability today, but it's the kind of thing a real deployment
  should never carry forward — a scoped role with only the privileges
  `apps/api` actually needs (no `DROP`/`CREATE SCHEMA`, which only the
  dev-only `db:reset` script uses).
- **No data-retention or deletion policy.** Location history
  (`ride_location_samples`, `driver_locations`), ride records, and
  support-ticket threads are retained indefinitely with no mechanism to
  purge or anonymize old data. Fine for Stage 1's fictional test data;
  a real deployment handling real riders' location history would need
  one (GDPR-style "right to be forgotten" or a simple retention window)
  before launch.
- **Stateless-JWT revocation lag**, restated from the Authentication
  section above for completeness: a compromised or suspended account's
  access token remains valid for up to `JWT_ACCESS_TOKEN_TTL` (15
  minutes by default) after the compromise/suspension, bounded but not
  instant.

## Manual test procedure

1. **Rate limiting fix**: hit `POST /auth/refresh` (or `/auth/logout`)
   more than 30 times in 15 minutes from one IP; confirm a `429
   RATE_LIMITED` response. Repeat against `GET /drivers/me` more than 30
   times in a minute as one authenticated driver; confirm the same.
2. **Document content-type fix**: attempt
   `POST /drivers/me/documents` with `contentType: "text/html"`; confirm
   a `400 VALIDATION_ERROR`. Confirm `contentType: "image/jpeg"` (or
   `image/png`/`image/webp`/`application/pdf`) still succeeds.
3. **Distance-cap fix**: drive a ride through to completion with two
   `ride_location_samples` rows inserted directly at an unrealistic
   distance apart (e.g. 500km) relative to a small `estimatedDistanceMeters`;
   confirm `actualDistanceMeters` on the completed ride is clamped to the
   cap (`max(estimate × 3, 5000)`), not the full 500km, and that a
   `logger.warn` line was emitted noting the cap.
4. Every "reviewed and found solid" claim above cites the exact
   file/function a reviewer can independently re-open and re-check —
   this review is reproducible by re-reading those files, not just by
   trusting this document.

## Tests

No new dedicated test file was added for this phase — all three fixes
are re-covered by the existing suite (`packages/validation`'s document
schema tests exercise `contentType`; `routes/rideLifecycle.test.ts` and
`routes/realtimeTracking.test.ts` exercise `computeActualDistanceMeters`
and would fail if the cap broke a legitimate trip's distance; the full
`apps/api` suite exercises every rate-limited route under `test`-mode's
1000× ceiling, so a limiter wired incorrectly — wrong import, missing
middleware call — would surface as a route failing to compile/mount, not
silently). Full monorepo lint/typecheck/build/test verification for this
phase is reported in the phase completion report.
