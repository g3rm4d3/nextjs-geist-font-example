# Deployment — Phase 24

## Scope

How this platform actually runs today (Stage 1: a single ephemeral
development container, never a persistent production deployment), what
a real deployment would need, and every environment variable each
piece reads. One of the docs required for Stage 1 Final Validation.

**Stage 1 has never been deployed anywhere real.** Every verification
this project has ever run — every phase's manual test procedure, the
Phase 19 load simulation, the Phase 21/24 Critical E2E test — has run
inside this same kind of sandboxed development container: a fresh
Postgres instance, no persistent storage across sessions, no public
DNS/TLS, no real Stripe/Expo/background-check credentials. That's the
honest current state, not a placeholder for a future section.

## Running it today (development)

```bash
# 1. Database
pg_ctlcluster 16 main start   # or however Postgres is managed in this environment
createdb rideshare_dev

# 2. Install + build (packages must build before apps/api/apps/admin-app
#    can typecheck/lint/test against them — see docs/architecture.md)
npm install
npm run build:packages

# 3. Migrate + (optionally) seed fixture data
npm run db:migrate
npm run db:seed     # 10 passengers, 50 drivers, 50 vehicles — see docs/database.md

# 4. Run the API
npm run dev:api      # tsx watch, or:
npm run build:api && node apps/api/dist/index.js

# 5. Run the admin console
npm run dev:admin    # or: npm run build:admin && npm run start --workspace=apps/admin-app

# 6. Run the mobile apps (Expo dev server; scan the QR with Expo Go, or
#    launch a simulator)
npm run dev:passenger
npm run dev:driver
```

`docs/architecture.md`'s "Toolchain version choices" and
`README.md`'s own quickstart cover the same ground in more detail;
this is the deployment-specific summary.

## Environment variables (`apps/api`)

Every one of these is read through `src/config/env.ts` — the single
module responsible for `process.env` access; nothing else in the
codebase reads `process.env` directly (so a missing/misspelled
variable fails fast at startup with a clear Zod error, not a silent
`undefined` three layers deep).

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` / `test` / `production`. |
| `PORT` | No | `4000` | HTTP listen port. |
| `CORS_ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowlist. |
| `DATABASE_URL` | **Yes** | — | `postgres://` / `postgresql://` connection string. |
| `DATABASE_POOL_MAX` | No | `10` | Connection pool size. |
| `LOG_LEVEL` | No | `info` (prod) / `debug` (else) | `debug`/`info`/`warn`/`error`. |
| `JWT_ACCESS_SECRET` | **Yes** | — | ≥32 chars; signs access tokens. **Never commit a real value.** |
| `JWT_ACCESS_TOKEN_TTL` | No | `15m` | Access token lifetime. |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | No | `30` | Refresh token lifetime. |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | No | `30` | Password reset token lifetime. |
| `MATCHING_OFFER_TIMEOUT_SECONDS` | No | `15` | Driver response window before a sweep-driven timeout. |
| `MATCHING_SWEEP_INTERVAL_MS` | No | `5000` | Background sweep cadence for expired offers. |
| `RIDE_LOCATION_SAMPLE_INTERVAL_MS` | No | `10000` | How often an in-progress ride's route breadcrumb is recorded. |
| `STRIPE_SECRET_KEY` | No | unset (MOCK provider) | **TEST MODE only** — `createStripePaymentProvider` enforces this. See "Payments" below. |
| `STRIPE_WEBHOOK_SECRET` | No | unset | Required alongside `STRIPE_SECRET_KEY` if set. |
| `EXPO_PUSH_ENABLED` | No | unset (MOCK provider) | Literal `"true"` to use the real Expo push provider. |
| `DOCUMENT_EXPIRATION_SWEEP_INTERVAL_MS` | No | `3600000` | Document-expiration warning sweep cadence. |

## Environment variables (client apps)

- `apps/admin-app`, `apps/passenger-app`, `apps/driver-app` each read
  an API base URL from their own `src/config/env.ts`
  (`EXPO_PUBLIC_API_URL` / `NEXT_PUBLIC_API_URL` — see each app's own
  doc for the exact variable name).
- `apps/passenger-app`/`apps/driver-app` additionally read
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` for Android map tiles (optional —
  see `docs/maps.md`; iOS uses Apple Maps and needs no key).

## Payments: TEST MODE only, by construction

`STRIPE_SECRET_KEY` unset (the default everywhere this project has
ever run) means the MOCK `PaymentProvider` is used — no network call
to Stripe at all. Setting it activates the real Stripe TEST MODE
provider, but `createStripePaymentProvider` itself refuses to start
with anything that isn't a `sk_test_...` key — there is no code path
in this codebase that can charge a real card. **[PRODUCTION PAYMENT
APPROVAL REQUIRED]** before this constraint would ever be relaxed —
see `PRODUCTION_READINESS_CHECKLIST.md`.

## What a real deployment would need (not built, not activated)

This section describes what's *architecturally possible* without a
rewrite, per the spec's own instruction ("architecture should not
unnecessarily prevent these features") — none of it exists today:

- **Persistent, managed Postgres** (RDS/Cloud SQL/etc.) instead of a
  container-local instance that resets between sessions.
- **A real process supervisor / container orchestrator** for
  `apps/api` (this environment runs it directly via `tsx`/`node`, with
  no restart policy, health-check-driven traffic routing, or rolling
  deploy — `GET /health`/`GET /ready`, Phase 22, are what such a setup
  would poll).
- **CI/CD** — there is no automated pipeline running lint/typecheck/
  test/build on every push in this environment; Phase 24's own
  verification (this doc's sibling, `docs/production-readiness.md`)
  has always been run by hand.
- **App Store / Play Store distribution** for the two Expo apps —
  **[APP STORE PRODUCTION REVIEW REQUIRED]** — this environment has no
  Apple/Google developer account and has never submitted a build.
- **A real domain, TLS certificate, and CORS allowlist** scoped to
  that domain — `CORS_ALLOWED_ORIGINS` defaults to `localhost` and has
  never been pointed at a real origin.
- **Centralized log aggregation** — `docs/troubleshooting.md`'s own
  Known Limitations already names this; structured logs today go to
  stdout only.
- **Secrets management** (a real vault/parameter store) instead of a
  local `.env` file — every secret this project has ever used
  (`JWT_ACCESS_SECRET`, test-only Stripe/webhook secrets) has been a
  locally-generated, never-committed, non-production value.

See `PRODUCTION_READINESS_CHECKLIST.md` for the itemized checklist
this list feeds into.
