# Rideshare Platform — Stage 1 (Development)

> **Stage 1: development and technical validation only.** This system is not
> launched commercially. All drivers, passengers, rides, transactions, and
> financial records used here are development/test data. Payment
> integrations run in Stripe **TEST MODE** only. See
> [`docs/architecture.md`](docs/architecture.md) for the full engineering
> rationale.

## What this is

A rideshare platform monorepo built from three independent applications plus
a backend API, all with **original code, branding, and UI** — no Uber/Lyft
code or assets are used anywhere in this repository.

| App | Path | Stack | Purpose |
| --- | --- | --- | --- |
| Passenger app | `apps/passenger-app` | Expo + React Native + TypeScript | Rider-facing mobile app |
| Driver app | `apps/driver-app` | Expo + React Native + TypeScript | Driver-facing mobile app |
| Admin app | `apps/admin-app` | Next.js + TypeScript + Tailwind | Internal operations console |
| API | `apps/api` | Node.js + Express + TypeScript | Authoritative backend |

The passenger app, driver app, and admin app are never merged with each
other. All three talk to the API over HTTP; none of them is a source of
truth for fares, ride state, driver assignment, or financial calculations —
the API is authoritative for all of that.

## Repository layout

```
/apps
  /passenger-app   Expo app (iOS/Android) for riders
  /driver-app      Expo app (iOS/Android) for drivers
  /admin-app       Next.js app for platform operators
  /api             Node/Express backend — the only app with database access

/packages
  /types           Shared TypeScript types (API envelopes, contracts)
  /config          Shared TypeScript + ESLint base configuration
  /logging         Shared structured logger (pino, with redaction)
  /database        PostgreSQL schema (Drizzle ORM), migrations, seed/reset scripts
  /auth            Shared password hashing (bcrypt)
  /validation      Shared Zod request-payload schemas
  /maps            Map/routing provider abstraction (server-side only)

/docs              Architecture and process documentation
/scripts           (reserved for future tooling — e.g. the driver/ride simulator)
/infrastructure    (reserved for deployment config — later phases)
```

See [`docs/architecture.md`](docs/architecture.md) for why each package
exists and how the apps are meant to evolve.

## Prerequisites

- Node.js 20+ and npm 10+ (see `.nvmrc`)
- PostgreSQL 16 running locally (or reachable via `DATABASE_URL`)
- For mobile apps: the [Expo Go](https://expo.dev/go) app on a physical
  device, or an iOS/Android simulator, to run `expo start`

## Setup

```bash
# 1. Install all workspace dependencies (npm workspaces — one install for the whole repo)
npm install

# 2. Build the shared packages once so apps can resolve their compiled output
npm run build:packages

# 3. Create local development databases (adjust user/password to your setup)
createdb rideshare_dev
createdb rideshare_test

# 4. Copy each app's env template and adjust as needed
cp apps/api/.env.example apps/api/.env
cp apps/admin-app/.env.example apps/admin-app/.env.local
cp apps/passenger-app/.env.example apps/passenger-app/.env
cp apps/driver-app/.env.example apps/driver-app/.env
cp packages/database/.env.example packages/database/.env

# 5. Generate a real JWT signing secret for apps/api (the placeholder in
#    .env.example is intentionally invalid — the API refuses to start
#    with it) and put it in apps/api/.env as JWT_ACCESS_SECRET.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 6. Create the schema and fill it with fictional dev data
npm run db:migrate
npm run db:seed
```

Never commit `.env` / `.env.local` files — they're gitignored. Never put
real secrets in a committed `.env.example`. See
[`docs/database.md`](docs/database.md) for the full schema, entity
relationships, and what `db:migrate` / `db:seed` / `db:reset` each do,
[`docs/authentication.md`](docs/authentication.md) for the auth/token
design and how to provision a local admin account, and
[`docs/maps.md`](docs/maps.md) for the routing provider abstraction and
its current dev-only (mock) implementation.

## Running each app independently

Every app has its own entry point, env config, and start command — none of
them depend on another app being open to launch.

```bash
# API — http://localhost:4000
npm run dev:api

# Admin app — http://localhost:3000
npm run dev:admin

# Passenger app — Expo dev server (scan the QR code with Expo Go, or press i/a)
npm run dev:passenger

# Driver app — Expo dev server
npm run dev:driver
```

Start the API first — the passenger app needs it for auth and route
preview, and the admin app's dashboard shows a live "Platform status"
card that calls `GET /health` on it.

The passenger app requires a device or simulator to actually see the map
render (this environment has neither — see `docs/maps.md` for what's
verified here vs. what needs a real device). Once running: register a
passenger account, allow location access (or drag the pickup pin
manually), tap "Where to?" and pick a sample destination, then "Preview
route" for a server-computed distance/duration.

## Verifying the API + database

```bash
curl http://localhost:4000/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-08-09T00:00:00.000Z",
    "uptimeSeconds": 12,
    "database": { "connected": true, "latencyMs": 3 }
  },
  "requestId": "..."
}
```

`data.database.connected` reflects real PostgreSQL connectivity — the
process can report `status: "ok"` while the database is briefly down; that's
intentional (see `docs/architecture.md`).

## Quality gates

Run from the repo root — these fan out to every workspace that defines the
script:

```bash
npm run lint         # ESLint (flat config) in every app/package
npm run typecheck     # tsc --noEmit in every app/package
npm run test          # Vitest (api, admin-app, packages) + Jest (mobile apps)
npm run build         # Production build for apps/api and apps/admin-app
npm run format:check  # Prettier check across the repo
```

The mobile apps don't have a "build" step in Stage 1 (no native binaries are
produced yet); `expo export --platform android` / `--platform ios` is used
in CI/manual validation to confirm the JS bundle compiles cleanly.

## Known limitations (Stage 1, through Phase 3)

- The API's `/health` check only proves connectivity (`SELECT 1`), not that
  the schema is migrated — a fresh, unmigrated database still reports
  `database.connected: true`.
- Password reset delivery returns the token directly in dev/test responses
  rather than sending a real email — Phase 16 owns real notification
  delivery.
- The driver app still renders only a static placeholder screen — its
  core (auth screens, onboarding, availability) is Phase 5's job.
- Route/distance calculation is a MOCK straight-line estimate
  (`@rideshare/maps`), not real road routing — see `docs/maps.md`. Fares
  are not shown yet at all (Phase 4).
- No Google Maps/Places API key is configured or verifiable in this
  environment: Android map tiles won't render without one, and
  destination search works against a small curated dev fixture list
  instead of free-form address geocoding (`docs/maps.md`).
- Ride matching, requests, and the rest of the ride lifecycle don't exist
  yet (Phases 7–9) — the passenger app's "Request Ride" and downstream
  screens are honest placeholders, not fake functionality.
- `npm audit` reports vulnerabilities inside Expo/Metro's own build-tooling
  dependency chain (dev-time only, not shipped to end users). These track
  upstream Expo/Metro releases and are not something this repo can fix by
  itself without downgrading the Expo SDK; revisit during Phase 20 (security
  review).

## License

Unreleased, unlicensed internal development project. Not for redistribution.
