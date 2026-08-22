# Production Readiness Checklist

Itemized companion to `docs/production-readiness.md` (read that first
for the narrative "why" behind each line here). This is Stage 1's own
honest accounting of what exists today versus what a real commercial
launch would still require — not a promotion path, and completing
every box below is still not sufficient on its own without the
non-technical reviews this checklist names explicitly.

Legend: ✅ done and tested · 🔶 built but deliberately not activated ·
⬜ not built.

## Core platform (technical)

- ✅ Ride state machine — 11 states, atomic transitions, ownership
  enforced (`docs/ride-state-machine.md`)
- ✅ Matching engine — eligibility, ranking, concurrency-safe offers
  (`docs/matching.md`)
- ✅ Pricing — server-computed estimate and final fare, integer cents
  (`docs/pricing.md`)
- ✅ Authentication & authorization — JWT + refresh rotation, role
  checks on every route (`docs/authentication.md`)
- ✅ Security review completed with findings fixed in-scope
  (`docs/security.md`)
- ✅ Automated test suite — 248 passing tests / 24 files as of this
  phase, including a full Critical E2E path (`docs/testing.md`,
  `docs/stage1-demonstration.md`)
- ✅ Observability — structured logs, correlation IDs, error tracker,
  metrics, `/health`/`/ready` (`docs/troubleshooting.md`)
- ✅ Admin console — full operational visibility across users, rides,
  payments, ratings, support, pricing, audit logs
  (`docs/admin-application.md`)
- ✅ Accessibility & offline handling pass on both mobile apps
  (`docs/design-system.md`)

## Payments

- 🔶 Real Stripe integration exists, hard-restricted to TEST MODE keys
  only (`docs/deployment.md`, `docs/payments.md`)
- ⬜ **[PRODUCTION PAYMENT APPROVAL REQUIRED]** — before
  `STRIPE_SECRET_KEY` may ever hold a live key, or the TEST-key
  restriction in `createStripePaymentProvider` is relaxed
- ⬜ Real, automated driver payouts — explicitly a "future feature, do
  not implement yet" per the governing spec; today's "driver earnings"
  are bookkeeping records only, never a money transfer

## Driver trust & safety

- 🔶 Background check provider abstraction exists; only the MOCK
  implementation has ever run (`packages/screening`)
- ⬜ **[BACKGROUND CHECK INTEGRATION REQUIRED]** — a real
  screening-provider integration before any driver onboarding could
  rely on a genuine check
- ⬜ Passenger account suspension capability — functional gap noted in
  `docs/security.md`, not built

## Distribution

- ⬜ **[APP STORE PRODUCTION REVIEW REQUIRED]** — `apps/passenger-app`
  and `apps/driver-app` have never been submitted to the Apple App
  Store or Google Play; no developer account exists in this project's
  history

## Infrastructure

- ⬜ Persistent managed database (every run to date used an ephemeral
  container-local Postgres — `docs/deployment.md`)
- ⬜ Process supervisor / orchestrator with restart policy and health-
  check-driven traffic routing
- ⬜ CI/CD pipeline (lint/typecheck/test/build have only ever been run
  by hand, at the end of each phase)
- ⬜ Real domain, TLS certificate, CORS allowlist scoped to it
- ⬜ Centralized log aggregation (stdout only today)
- ⬜ Production secrets management (every secret used to date has been
  a locally-generated, non-production value)
- ⬜ Data-retention / deletion policy for location history, ride
  records, and support threads (`docs/security.md`)

## Legal & regulatory (non-technical — no engineering substitutes)

- ⬜ **[LEGAL REVIEW REQUIRED]**
- ⬜ **[INSURANCE REVIEW REQUIRED]**
- ⬜ **[TNC COMPLIANCE REQUIRED]** (transportation network company
  licensing, by jurisdiction)
- ⬜ **[PRIVACY REVIEW REQUIRED]**
- ⬜ **[TERMS OF SERVICE REQUIRED]**

## Features explicitly deferred past Stage 1 (per the governing spec — not started)

Scheduled rides, multiple stops, airport rides, ride categories,
premium vehicles, promo codes, referral program, dynamic/surge
pricing, driver incentives, passenger subscriptions, business
accounts, family accounts, favorite locations, split fare, tips,
safety center, emergency assistance integration, trip sharing, fraud
detection, driver heatmaps, destination filters, driver reservations,
automated payouts, advanced dispatching, geofenced pricing,
multi-city support. None of these were implemented — confirmed absent
by an explicit Phase 24 code sweep, not merely by omission from this
list.

## Bottom line

Stage 1 is a complete, tested, internally-consistent technical
foundation for a rideshare platform. It has never performed a real
ride, moved real money, run a real background check, or been
distributed to a real user. Every gap above is a known, named
prerequisite — not a surprise a future engineer would have to
discover.
