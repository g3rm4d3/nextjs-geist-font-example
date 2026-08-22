# Production Readiness — Phase 24

## Scope

A narrative assessment of where Stage 1 stands relative to a real
commercial launch: what's genuinely solid, what's a deliberate Stage 1
stand-in, and what's an outright gap — one of the docs required for
Stage 1 Final Validation. This doc explains and justifies each item;
`PRODUCTION_READINESS_CHECKLIST.md` (repo root) is the itemized,
scannable checklist version of the same assessment, tagged with the
spec's own `[... REQUIRED]` markers. Read this first for the "why",
that for the "what's left."

**Stage 1 is, and has only ever been, a development/technical
validation build.** Every one of the 24 phases in the governing
specification was scoped that way from Phase 1 onward — this document
is a checkpoint on that same build, not a new promotion path toward
launch. Nothing here authorizes moving any item out of Stage 1; that
requires the explicit reviews named throughout.

## What's genuinely solid

These are load-bearing, tested, and would survive a real launch
largely unchanged:

- **The ride state machine** (`docs/ride-state-machine.md`) — eleven
  states, atomic conditional-`UPDATE` transitions, ownership enforced
  in every `WHERE` clause. Proven correct under concurrent access
  (Phase 21's matching race fix, Phase 19's 50-driver load simulation).
- **Money handling** — integer cents everywhere, server-computed at
  every step (`docs/pricing.md`, `docs/payments.md`), never trusted
  from the client (`docs/security.md`'s fare-manipulation findings and
  fixes).
- **Authentication & authorization** (`docs/authentication.md`,
  `docs/security.md`) — bcrypt hashing, JWT access + rotating refresh
  tokens, role checks on every protected route, a dedicated Phase 20
  review sweep (authN, IDOR, role escalation, injection, CSRF, rate
  limiting) that found and fixed real issues rather than rubber-
  stamping the design.
- **Test coverage** — 248 passing `apps/api` tests across 24 files as
  of this phase (`docs/testing.md`), including a dedicated Critical
  E2E test (`apps/api/src/routes/criticalPath.test.ts`) exercising the
  full registration-through-admin-inspection path end to end.
- **Provider abstractions** (`packages/payments`, `packages/screening`,
  `packages/notifications`, `packages/storage`, `packages/maps`) — each
  a real interface with a MOCK implementation used everywhere in this
  project, and in most cases a genuine non-mock implementation behind
  it (real Stripe TEST MODE, real Expo push) that was never activated
  by default. Swapping providers is a config change, not a rewrite.
- **Observability** (`docs/troubleshooting.md`, Phase 22) — structured
  logs with request correlation IDs, an in-process error tracker and
  metrics collector, `/health`/`/ready` endpoints a real orchestrator
  could poll today.

## What's a deliberate Stage 1 stand-in (architecturally ready, not activated)

Each of these has a real, non-mock implementation already built and
tested, deliberately never switched on by default:

- **Payments** — `createStripePaymentProvider` (`packages/payments`)
  is real Stripe integration, but only in TEST MODE; it refuses any
  key that isn't `sk_test_...`. See `docs/deployment.md`'s "Payments"
  section. **[PRODUCTION PAYMENT APPROVAL REQUIRED]** before this
  constraint is ever relaxed.
- **Background checks** — `packages/screening`'s MOCK provider is what
  every driver onboarding in this project has ever run against; a real
  provider integration was never built. **[BACKGROUND CHECK
  INTEGRATION REQUIRED]** before driver onboarding could rely on a
  genuine check.
- **Push notifications** — the real Expo push provider exists
  (`EXPO_PUSH_ENABLED=true`) but every test/dev run in this project has
  used the MOCK provider (`docs/notifications.md`).

## What's an outright gap (not built at all)

- **No CI/CD pipeline** — lint/typecheck/test/build have been run by
  hand at the end of every phase; nothing runs them automatically on
  push. See `docs/deployment.md`.
- **No persistent/managed database, process supervisor, real domain,
  TLS, or centralized log aggregation** — every phase, including this
  one, has run inside a single ephemeral development container. See
  `docs/deployment.md`'s "What a real deployment would need" section
  for the full list.
- **No App Store / Play Store submission** for `apps/passenger-app` or
  `apps/driver-app` — **[APP STORE PRODUCTION REVIEW REQUIRED]**.
- **No legal, insurance, or regulatory review of any kind** — no
  Terms of Service, no Privacy Policy, no TNC (transportation network
  company) licensing analysis. These are non-technical prerequisites
  no amount of further engineering substitutes for: **[LEGAL REVIEW
  REQUIRED]**, **[INSURANCE REVIEW REQUIRED]**, **[TNC COMPLIANCE
  REQUIRED]**, **[PRIVACY REVIEW REQUIRED]**, **[TERMS OF SERVICE
  REQUIRED]**.
- **No production secrets management** — every secret this project has
  ever used has been a locally-generated, non-production value; see
  `docs/deployment.md`.
- **No data-retention/deletion policy** and **no passenger account
  suspension capability** — both named in `docs/security.md`'s Known
  Limitations as real gaps, not vulnerabilities in what exists.

## The Stage 1 boundary, restated

Nothing in this codebase performs a real ride, moves real money, runs
a real background check, or has been distributed through an app
store. That boundary is enforced structurally, not just by convention
— see `PRODUCTION_READINESS_CHECKLIST.md` for the itemized audit
confirming it, and the repository's own governing specification for
the exact list of what must stay outside Stage 1 and which future
features were deliberately left unbuilt.

## Known limitations

This document is itself a snapshot as of Phase 24 — it does not
predict what a future phase beyond this specification's 24 phases
would need to change; the spec explicitly ends here, with no Phase 25.
