# Troubleshooting & Observability — Phase 22

## Scope

This is the operator-facing companion to the rest of `docs/` — those
documents explain what each phase built; this one explains how to
actually diagnose something going wrong in a running `apps/api`
process, using the observability primitives this phase adds on top of
what earlier phases already had (structured logs since Phase 1,
request IDs and the audit trail since Phase 14).

## The four correlation IDs

Every piece of operational data in this system can be traced back to
one of these. Knowing which one you have determines where to look.

| ID | Where it comes from | What it correlates |
|---|---|---|
| **`requestId`** | `middleware/requestId.ts` — generated per HTTP request (or reused from an inbound `X-Request-Id` header from a trusted upstream proxy), returned on every response in the same header. | Every log line, error-tracker event, and audit-log row produced *by that one request*. |
| **`rideId`** | The `rides.id` primary key. | Every log line about that ride's story — matching, lifecycle transitions, payment, earnings, notifications — across every request that ever touched it, *and* across background work with no request at all (the matching sweep, a Stripe webhook). See "Ride correlation" below. |
| **`userId`** | The authenticated user's `users.id`. | A user's own actions across auth, ride, and admin-inspection logs. Present wherever a request was authenticated. |
| **`entityId`** (in the audit trail) | Whatever admin-mutated row the action touched (a driver, a document, a pricing config, ...). | The durable, queryable *what changed* record — see "Audit trail" below, distinct from logs. |

`requestId` and `rideId` deliberately don't depend on each other:
`rideId` must keep working even when there's no HTTP request in scope
at all (the background matching sweep, `src/index.ts`; an async Stripe
webhook delivery). If you have a `rideId`, you can reconstruct that
ride's entire story without ever needing a `requestId`.

## Structured logs

`packages/logging` (`createLogger`, wraps [pino](https://getpino.io/))
is the one logger every part of `apps/api` uses (`src/lib/logger.ts`).
Every line is a single JSON object, so log aggregation and `grep` both
work the same way whether you're reading a file or piping through
`jq`. Key fields to filter on:

- `service` — always `"api"` today (single-process Stage 1 deployment).
- `level` — `debug` / `info` / `warn` / `error` (`fatal`/`trace` also
  exist via pino but aren't used here).
- `requestId` / `rideId` / `userId` — see the table above.
- `msg` — a human-readable one-liner; the rest of the object is the
  structured context.
- pino-http (mounted in `app.ts`) also auto-logs every request/response
  pair with `req`, `res`, and `responseTime` (ms) — this is the
  cheapest way to answer "how long did this endpoint take" without
  reaching for `GET /admin/metrics` at all, and it's what
  `GET /admin/metrics` itself is built on top of conceptually.

**Never logged** — enforced by `packages/logging`'s `redact` config
(`REDACTED_PATHS`), which replaces these fields with `[REDACTED]`
regardless of nesting depth, so an accidental `logger.info(user)` can't
leak them even if a call site forgets to pick fields carefully:
`password`, `newPassword`, `currentPassword`, `token`, `accessToken`,
`refreshToken`, `authorization` (and `req.headers.authorization`),
`cookie` (and `req.headers.cookie`), `apiKey`, `secret`,
`webhookSecret`, `cardNumber`, `cvv`. Two things beyond the redaction
list, true by construction rather than by a runtime filter:

- **Full card information** never reaches the process at all — Stripe
  Elements/Checkout collects card details directly on Stripe's own
  infrastructure (see `docs/payments.md`); `apps/api` only ever holds a
  `providerPaymentMethodId` reference, so there is no card number for
  any log line to leak in the first place.
- **Private document contents** are never logged — every
  document-related log call (`documentService.ts`,
  `adminDocumentService.ts`) logs only a `documentId` reference, never
  the uploaded bytes; pino-http's own request auto-logging logs
  headers/method/url/status, not the request body, so a document
  upload's base64 payload never reaches a log line either.

Every call site is still individually responsible for not passing
something sensitive in the first place — the redact list is a safety
net for the fields most likely to leak by accident (a whole `user` or
`req.body` object), not a substitute for reviewing what a new
`logger.*()` call actually includes.

## Ride correlation

`repositories/ridesRepository.ts`'s `advanceRideStatus` is the one
function every ride status change in this codebase goes through (see
its own doc comment) — which makes it the one place that logs an
`info`-level `'Ride transition'` line for *every* transition, tagged
with `rideId`, `fromStatus`, `toStatus`, `actorType`. Filtering logs on
one `rideId` reconstructs that ride's entire lifecycle without needing
to know which requests (if any) drove each step.

This is the operational/log-stream view of the same fact the
`ride_events` table (Phase 9) records durably in the database, written
in the very same transaction — `ride_events` is the source of truth
you'd query for a permanent record or an admin UI; the log line is
what you'd `grep`/aggregate for live troubleshooting. `matchingService`
and `rideLifecycleService` also tag their own `info`/`warn`/`error`
log lines with `rideId` at the specific points where something
noteworthy happens beyond a bare status change (an offer made, a
notification failure, a fare-cap trigger) — all under the same
`rideId` field, so one filter covers all of it.

## Error tracking (`@rideshare/observability`)

`ErrorTracker` (`packages/observability/src/errorTracker.ts`) is a
small abstraction — the same shape as this codebase's other provider
abstractions (`PaymentProvider`, `NotificationProvider`,
`StorageProvider`, ...): one interface, one composition point
(`apps/api/src/lib/errorTracker.ts`), swappable without touching call
sites. `middleware/errorHandler.ts` calls
`errorTracker.captureException(err, { requestId, route })` for every
unhandled error and every `AppError` with a `5xx` status — never for
expected `4xx` outcomes (a validation failure, a 404, a conflict),
which already get a `logger.warn(...)` instead and aren't failures
worth tracking.

Stage 1 ships exactly one implementation,
`createLoggingErrorTracker` — it routes every captured exception
through the same structured, redacted logger as everything else,
tagged with `event: 'error_tracked'` so it can be filtered as its own
stream (e.g. "every 5xx, ever, across all routes") distinct from
routine `warn`/`error` lines for expected failure paths. This is not a
placeholder standing in for a real external service the way, say,
`packages/screening`'s MOCK stands in for a real background-check
API — there is genuinely no error-tracking service (Sentry, Rollbar,
...) configured or reachable in this Stage 1 environment, and none is
needed for technical validation. A real provider is a drop-in
`ErrorTracker` implementation behind the same interface whenever one
is actually wired up.

**To find every server-side error for a given time window**: filter
structured logs for `event:"error_tracked"`, or equivalently for
`level:"error"` — every `captureException` call happens alongside a
`logger.error(...)` call at the same call site, so the two overlap
completely today. `requestId` on each entry lets you pull the exact
request (and, via pino-http's auto-logged pair, the exact response)
that produced it.

## Performance metrics (`@rideshare/observability`)

`middleware/metrics.ts` records one sample (`method`, `route` pattern,
`statusCode`, `durationMs`) per response into a shared in-memory
`MetricsRecorder`, aggregated per route+method. `GET /admin/metrics`
(admin-only, same access level as `GET /admin/settings`) returns the
current aggregate: request count, error count (`statusCode >= 500`),
average/max/p95 latency, sorted busiest-route-first.

```bash
curl -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  http://localhost:4000/admin/metrics
```

**What this is, and isn't**: a lightweight, dependency-free,
in-process aggregate — not Prometheus/StatsD/OpenTelemetry, which need
an external collector this environment has no way to provision. It
resets on every process restart and reflects only the instance that
answered the request (no cross-instance aggregation) — a complete
picture for Stage 1's single-process deployment, not a substitute for
a real metrics backend in a horizontally-scaled one. For anything
beyond "what's slow or erroring right now," pino-http's per-request
`responseTime` field in the structured logs above is the durable
record to reach for instead.

## Health vs. readiness

Two endpoints, two different questions, both unauthenticated (an
orchestrator/load balancer polling either one shouldn't need
credentials):

| Endpoint | Question | Always 200? |
|---|---|---|
| `GET /health` | "Is the process up and answering requests at all?" | Yes — even if the database is unreachable, the process itself is alive; inspect `data.database.connected` for that separately. |
| `GET /ready` (Phase 22) | "Can this instance actually serve traffic right now?" | No — `503` the moment the database (today's one hard dependency) is unreachable, `200` otherwise. |

Use `/health` for "is the container alive" (a liveness probe should
almost never restart a container just because its database had a
blip); use `/ready` for "should traffic be routed here right now" (a
readiness probe/load balancer target should stop sending requests to
an instance that can't serve them, without killing the process).

## Audit trail

Phase 14's `audit_logs` table (`services/auditService.ts`,
`repositories/auditLogsRepository.ts`) is the durable record of every
sensitive *admin-initiated* mutation — driver moderation, document
review/replacement requests, pricing/settings changes, support-ticket
status changes — never read-only "inspect" actions, which change
nothing and so have nothing to record. Each row carries
`actorUserId`/`actorRole` (who), `action`/`entityType`/`entityId`
(what), `before`/`after` (the actual change), plus `requestId` and
`ipAddress` for correlation back to the exact request. `GET
/admin/audit-logs` is the read surface (`docs/admin-application.md`
covers the frontend).

The audit trail and structured logs answer different questions: the
audit trail is "what did an admin change, permanently and
queryably" — it never expires and is never sampled away; logs are
"what was the system doing, operationally, right now" — useful for
live debugging, not guaranteed to be retained forever in a real
deployment (Stage 1 just writes to stdout/a log file).

## Common troubleshooting scenarios

**"A specific ride seems stuck."**
1. Grab its `rideId` (from the passenger/driver app, or
   `GET /admin/rides/:id`).
2. Filter logs for that `rideId` — the `'Ride transition'` lines from
   `advanceRideStatus` show every status change with a timestamp;
   `matchingService`'s own `rideId`-tagged lines show every offer
   attempt if it's stuck in `SEARCHING_DRIVER`.
3. Cross-check `ride_events` (`SELECT * FROM ride_events WHERE ride_id
   = '...' ORDER BY created_at`) for the same story, durably.

**"A user says a request failed."**
1. If you have the `requestId` (returned in every response's
   `X-Request-Id` header and JSON body), filter logs for it directly —
   one request's entire story, including pino-http's auto-logged
   request/response pair.
2. If you only have a rough time and a `userId`, filter logs for
   `userId` in that window instead.

**"Is the API even healthy?"**
`GET /health` for "is it up," `GET /ready` for "can it serve traffic
right now," `GET /admin/metrics` for "is anything unusually slow or
erroring more than expected."

**"An admin says something got changed that shouldn't have."**
`GET /admin/audit-logs`, filtered by `entityType`/`entityId` — the
durable `before`/`after` record, with the acting admin's `userId` and
the `requestId` that made the change.

## Known limitations

- **Metrics are per-process and in-memory** — no cross-instance
  aggregation, reset on restart. See "Performance metrics" above.
- **No real error-tracking service is configured** — every "tracked"
  error lands in structured logs, not a dashboard with alerting,
  deduplication, or issue tracking. See "Error tracking" above for why
  that's a deliberate Stage 1 choice, not an oversight.
- **`/ready`'s only dependency check is the database.** A real
  deployment with more hard dependencies (a cache, a queue, an
  external payment gateway) would want those checked too; Stage 1's
  only genuinely hard dependency is Postgres.
- **Logs are not centrally aggregated** — this doc assumes you're
  reading `apps/api`'s own stdout/log file (or whatever ships it, e.g.
  `docker logs`) directly; there is no log-shipping/aggregation
  pipeline configured in this Stage 1 environment.
