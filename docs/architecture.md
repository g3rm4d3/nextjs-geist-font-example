# Architecture — Phase 0 (Engineering Foundation)

This document explains the shape of the monorepo as of Phase 0 and the
reasoning behind it. It will grow alongside later phases rather than being
rewritten from scratch each time.

## Why three separate applications

The passenger app, driver app, and admin app are three independent
codebases with independent entry points, navigation, environment
configuration, build commands, and deployment targets. They are **not**
different modes of one app, and they must never be merged:

- A passenger's device should never contain driver-only code, screens, or
  API scopes, and vice versa.
- The admin app is a privileged internal tool; it must be deployable (and
  revocable) completely independently of either mobile app's release cycle.
- This also keeps each app's bundle small and its permission surface
  minimal — the passenger app has no reason to link anything related to
  driver document review, for instance.

## Service boundary: the API is authoritative

All three client apps are just that — clients. None of them is trusted to
compute or decide:

- fares or any financial calculation
- ride state transitions
- driver assignment / matching
- driver earnings
- permissions / roles
- payment status

Every one of those lives behind `apps/api`, which is the only application
with direct database access. Clients call the API and render what it
returns; they never derive authoritative values locally. Hiding a button in
a client UI is explicitly **not** authorization — Phase 2 will add
server-side role checks for exactly this reason.

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ Passenger App   │     │  Driver App     │     │  Admin App      │
│ (Expo / RN)     │     │  (Expo / RN)    │     │  (Next.js)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │  HTTP (JSON, versioned envelopes)              │
         └─────────────────────┬───────────────────────────┘
                                │
                       ┌────────▼────────┐
                       │   apps/api       │  ← sole owner of business logic
                       │ (Node/Express)   │     and database access
                       └────────┬────────┘
                                │
                       ┌────────▼────────┐
                       │   PostgreSQL     │
                       └─────────────────┘
```

## Repository layout and package rationale

```
/apps
  /passenger-app   Expo app — riders
  /driver-app      Expo app — drivers
  /admin-app       Next.js app — internal operators
  /api             Node/Express backend

/packages
  /types           Shared TypeScript types: API response envelopes,
                    request/response contracts. Grows as each phase adds
                    real domain types (ride, driver, payment, ...).
  /config          Shared TypeScript + ESLint base configuration so every
                    workspace enforces the same strictness instead of
                    drifting app by app.
  /logging         Shared structured logger (pino) with baked-in
                    redaction of sensitive fields (passwords, tokens,
                    secrets). Used by apps/api today; any future backend
                    service reuses it instead of re-implementing logging.
  /database        PostgreSQL schema (Drizzle ORM), migrations, and
                    dev seed/reset scripts (Phase 1). See docs/database.md.
  /auth            Shared password hashing (bcrypt) used by apps/api and
                    packages/database's seed script, so both hash
                    passwords identically (Phase 2).
  /validation      Shared Zod request-payload schemas. apps/api runs
                    these server-side as the authoritative check; client
                    apps may reuse them for form UX only (Phase 2).
  /maps            Map/routing provider abstraction (RouteProvider).
                    Consumed server-side only (apps/api) — no map API key
                    is ever embedded in a mobile client bundle (Phase 3).
                    See docs/maps.md.
```

**When adding a new `packages/*` with its own `build` script:** also add it
to the root `build:packages` chain in `package.json` (plain npm workspaces
has no automatic topological build ordering — this has already been
missed twice, once for `packages/database`/`packages/auth`/`packages/validation`
in Phase 2 and once for `packages/maps` in Phase 3, both caught by running
a from-scratch `npm run build` before committing).

Per the engineering spec, packages are only extracted when there's a
legitimate, current architectural reason — not speculatively. Phase 0
deliberately did **not** create `/packages/database`, `/packages/pricing`,
`/packages/matching`, `/packages/ride-engine`, etc. `/packages/database`
was added in Phase 1, once there was an actual schema to own; the rest
still wait for the phases that need them (pricing logic in Phase 4,
matching in Phase 8, ...), so their shape is driven by real requirements
instead of guesses.

## Request/response contract

Every API endpoint responds with one of two shapes, defined once in
`@rideshare/types` and reused by every client:

```ts
type ApiSuccessResponse<T> = { success: true; data: T; requestId: string };
type ApiErrorResponse = {
  success: false;
  error: { code: string; message: string; details?: Record<string, string[]> };
  requestId: string;
};
```

`requestId` is generated per-request (`apps/api/src/middleware/requestId.ts`)
and threaded through logs, the response body, and the `X-Request-Id`
response header, so a single request can be traced end-to-end. Later phases
extend this into ride-correlation IDs and audit records (Phase 22).

## Error handling

Route handlers throw a typed `AppError` (or a subclass like
`ValidationError` / `NotFoundError`) and let Express 5's automatic
async-rejection forwarding carry it to the single centralized
`errorHandler` middleware (`apps/api/src/middleware/errorHandler.ts`).
Nothing in a route handler needs its own try/catch-and-format boilerplate,
and unexpected exceptions are always reduced to an opaque `500
INTERNAL_ERROR` for clients — internal error details never leak, they only
go to the server-side log.

## Configuration

Every app validates its own environment at startup rather than trusting
`process.env` directly:

- `apps/api` uses a Zod schema (`src/config/env.ts`) and exits immediately
  with a clear message if configuration is invalid — failing fast beats
  failing weird three requests later.
- `apps/admin-app` uses Next.js's `NEXT_PUBLIC_*` convention for anything
  the browser needs; nothing else is exposed client-side.
- `apps/passenger-app` / `apps/driver-app` use Expo's `EXPO_PUBLIC_*`
  convention, inlined at build time.

Every app ships a `.env.example` and gitignores its real `.env*` files. No
secret is ever hardcoded.

## Database health vs. process health

`GET /health` reports two things independently: whether the HTTP process
itself is up (`status: "ok"`), and whether it can currently reach
PostgreSQL (`data.database.connected`). A database blip does not fail the
health check outright — that distinction matters operationally (a load
balancer shouldn't necessarily pull the instance for a transient DB hiccup,
but an on-call engineer should still see it) and will matter more once
Phase 22 (observability) adds a separate readiness endpoint.

## Toolchain version choices

The monorepo pins fairly recent, but not always the single latest, major
versions, chosen for actual cross-tool compatibility rather than novelty:

- **TypeScript `~6.0.3`** — one major ahead of 5.x, but specifically
  *not* the newer `7.x` line, because `@typescript-eslint` (used for
  linting everywhere) currently supports TypeScript `<6.1.0`. This is also
  what Expo SDK 57's own project template pins.
- **ESLint `^10` for Node packages** (`apps/api`, `packages/*`), but
  **ESLint `^9` for `apps/admin-app`, `apps/passenger-app`, and
  `apps/driver-app`** — `eslint-config-next` and `eslint-config-expo` both
  pull in `eslint-plugin-react`, which currently throws under ESLint 10's
  rule-context API. Pinning those three apps to ESLint 9 is a deliberate,
  verified compatibility choice, not an oversight; revisit when upstream
  fixes land.
- **Jest `^29` (not `^30`) for the mobile apps** — `jest-expo` currently
  depends on Jest 29-era packages (`jest-environment-jsdom@^29`,
  `jest-snapshot@^29`, etc.). Running the Jest 30 CLI against those
  produces a `jest-mock` API mismatch at runtime. `apps/api` and the
  Vitest-based packages are unaffected and use current versions.

## Testing strategy at Phase 0

- `apps/api`, `packages/types`, `packages/logging`, `apps/admin-app`: Vitest.
- `apps/passenger-app`, `apps/driver-app`: Jest via `jest-expo` (the
  standard React Native testing preset; Vitest does not support the RN
  runtime).

Phase 0's own tests are deliberately narrow: they prove the scaffolding
works (health check reachable and DB-aware, error envelope shape, shared
config module behavior, a rendered React component). Domain test coverage
(ride state machine, pricing, matching, ...) is built out in the phases
that introduce that logic.
