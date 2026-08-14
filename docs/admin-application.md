# Admin Application — Phase 14

## Scope

Section 14: expand the independent Admin App into every listed section
(Dashboard, Live Operations, Passengers, Drivers, Driver Applications,
Vehicles, Documents, Rides, Payments, Earnings, Ratings, Support,
Pricing, System Settings, Audit Logs); the admin actions (approve
driver, reject driver, suspend driver, reactivate driver, inspect
passenger, inspect ride, inspect payment, change pricing, review
documents); "sensitive admin operations generate audit records"; and
SUPER_ADMIN being distinguishable from ADMIN "where necessary."

No new migration was needed. `audit_logs`, `driver_documents`,
`support_tickets`/`support_messages`, `system_settings`,
`driver_profiles.average_rating`/`ratings_count`, and `pricing_configs`
were all fully defined in Phase 1's schema anticipating this phase —
this is the first phase to read or write most of them.

## SUPER_ADMIN vs. ADMIN

The spec leaves "where necessary" for the implementation to decide. The
line drawn here: **ADMIN** handles routine, reversible moderation —
approve/reject a driver application, review a document, and inspect
every section (nothing "inspect"-shaped is ever restricted further,
since it changes no state). **SUPER_ADMIN** is reserved for actions with
either a severe, hard-to-reverse effect on one person's ability to work
(suspending/reactivating an already-approved driver, pulling them out of
service mid-career) or a platform-wide effect (changing pricing, writing
system settings, reading the audit trail itself — which includes every
other admin's actions, including other SUPER_ADMINs').

Enforced with `requireRole('ADMIN', 'SUPER_ADMIN')` vs.
`requireRole('SUPER_ADMIN')` on individual routes:

| Action | Who |
|---|---|
| Approve / reject driver | ADMIN, SUPER_ADMIN |
| Suspend / reactivate driver | SUPER_ADMIN only |
| Review documents | ADMIN, SUPER_ADMIN |
| Inspect (passengers, drivers, rides, payments, ratings, vehicles, support) | ADMIN, SUPER_ADMIN |
| View pricing / settings | ADMIN, SUPER_ADMIN |
| Change pricing | SUPER_ADMIN only |
| Write a system setting | SUPER_ADMIN only |
| View audit logs | SUPER_ADMIN only |

admin-app's sidebar nav hides SUPER_ADMIN-only *sections* (audit logs)
entirely for a plain ADMIN, and hides SUPER_ADMIN-only *actions* (suspend
driver, change-pricing form, settings-write form) inline within
sections a plain ADMIN can otherwise view. This is a UI convenience
only — every one of these routes still enforces its own `requireRole`
server-side regardless of what the client believes.

## Audit records

"Sensitive admin operations generate audit records" is read as applying
to **mutating** admin actions only — approve/reject/suspend/reactivate
driver, document review, pricing changes, and settings writes — not to
read-only "inspect" actions, which change no state and have nothing to
record.

`auditService.recordAuditLog` writes one append-only row per action to
`audit_logs`: `actorUserId`/`actorRole` (from the server-verified JWT,
never client-supplied), `action` (a short dotted string like
`driver.suspend`, `pricing.change`), `entityType`/`entityId`, `before`/
`after` (opaque JSON snapshots — shape depends on `entityType`), and
`ipAddress`/`requestId` for traceability. Every mutating admin service
function calls it as its last step, after the actual state change
succeeds. A shared `AuditActorContext` (`{ userId, role, requestId?,
ipAddress? }`) is built once per route handler from `req.auth`/
`req.requestId`/`req.ip` and threaded into the service — services never
take Express `req` objects directly, consistent with the rest of this
codebase.

## Driver moderation

The four transitions (section 14: "approve driver, reject driver,
suspend driver, reactivate driver") are plain atomic conditional
`UPDATE ... WHERE id = ? AND onboarding_status = fromStatus` calls — the
same compare-and-swap pattern every other state transition in this
codebase uses (`ridesRepository.advanceRideStatus`,
`paymentsRepository.markPaymentOutcome`). Each returns `undefined` if
the driver wasn't in the expected starting status, which the service
layer turns into a `409` rather than silently no-oping:

- `approveDriver` / `rejectDriver`: `PENDING_REVIEW → APPROVED` /
  `REJECTED`. Rejecting requires a `reason` (recorded in the audit
  entry; there's no driver-facing "why was I rejected" screen in
  Stage 1).
- `suspendDriver`: `APPROVED → SUSPENDED`, reason required. Also forces
  `availability_status` to `OFFLINE` in the same `UPDATE` —
  `driver_profiles_availability_requires_approval_chk` only allows
  `ONLINE`/`BUSY` while `onboarding_status = APPROVED`, so leaving
  availability untouched would make the `UPDATE` itself violate that
  constraint the instant `onboarding_status` stops being `APPROVED`.
- `reactivateDriver`: `SUSPENDED → APPROVED`.

**"Driver Applications" is not a separate backend concept.** It's
`GET /admin/drivers?onboardingStatus=PENDING_REVIEW` — the same list as
"Drivers," filtered — because the underlying data is identical.
admin-app exposes it as its own nav item and page anyway (with inline
approve/reject actions) since that's how an admin actually works the
queue.

## Documents

`driver_documents.review_status` moves `PENDING → APPROVED`/`REJECTED`
via the same compare-and-swap shape: a document already reviewed can't
be silently re-reviewed out from under whoever looked at it first (a
second review attempt is a `409`). Rejecting requires `rejectionReason`
(enforced by a Zod `.refine()` on the request schema, not two separate
endpoints for approve vs. reject).

## Versioned pricing, not in-place edits

"Change pricing" never mutates an existing `pricing_configs` row's
numbers. It inserts a new, distinctly-named row and makes it `active`,
atomically deactivating whichever config was active before, all inside
one transaction — mirroring how Phase 11 records a payment retry as a
new row rather than mutating the old one. Every past config stays in
the table (`GET /admin/pricing/configs` returns full history, newest
first), so an admin can see exactly what changed and when. A duplicate
`name` is a `409`, and the numeric bounds mirror `pricing_configs`' own
CHECK constraints.

## System settings

`system_settings` is a generic admin-editable key/value store
(`key` unique, `value` a JSON column, optional `description`). Unlike
pricing, a setting genuinely gets mutated in place on
`PUT /admin/settings/:key` (insert-or-update by key) — there's no
history requirement here, just current state; the audit log is what
preserves the change history if one is ever needed. `value` is
deliberately untyped (`z.unknown()` server-side, a raw JSON textarea in
admin-app) since nothing in Stage 1 defines a fixed settings schema yet.

## Dashboard

`GET /admin/dashboard` is one call fetching every count an admin would
otherwise gather by visiting each section individually: total
passengers/drivers, pending driver applications, pending documents,
active ride count, open support ticket count, today's ride count, and
today's platform commission (reusing Phase 12's
`getPlatformRevenueSummary` for the last figure rather than a second
revenue calculation). Every number is computed fresh on each request —
no cached/denormalized totals table — which is fine at Stage 1's scale
and keeps this phase from introducing a new consistency problem.

## Earnings: per-driver breakdown

Phase 12's `docs/financial-ledger.md` explicitly deferred a per-driver
drill-down to "Phase 14's broader admin tooling." That's
`GET /admin/earnings/by-driver`: `driver_earnings` grouped by `driverId`
in SQL (not JS — the table can grow without bound), joined to
`driver_profiles` for the name, sorted by gross fare descending.
Platform-wide Today/Week/Month/All-time totals stay exactly where
Phase 12 put them (`GET /admin/revenue`); this is additive, not a
replacement, and admin-app's `/revenue` page ("Earnings" in the nav) now
shows both the period cards and this table on one page.

## Support tickets (read side only)

`support_tickets`/`support_messages` (Phase 18's schema, already fully
defined) get their first reader in this phase. A ticket's `userId` can
belong to either a passenger or a driver account, so
`supportRepository` left-joins both `passenger_profiles` and
`driver_profiles` on `userId` and the service layer picks whichever side
is non-null. Message threads are returned oldest-first (the one list in
this phase that isn't newest-first — a conversation reads top to
bottom), including admin-only internal notes
(`support_messages.is_internal_note`). Nothing writes a ticket or
message yet in Stage 1 — the passenger/driver-facing "open a ticket"
flow is a later phase — so this is a real, functional read over
whatever rows exist, which in a fresh environment is none.

## Ratings (read side only)

`GET /admin/ratings` lists every rating across every ride, both
directions, newest first — read-only, matching `docs/ratings.md`'s own
"no rating moderation" known limitation. Since `ratings.rater_user_id`/
`ratee_user_id` reference `users.id` directly (no name there), the
repository joins through `rides` to reach both the passenger's and the
driver's name in one row, and the service picks rater-vs-ratee based on
`direction`.

## Routes

All under `requireAuth` + `adminLimiter` (a single shared per-user rate
limiter across every admin section, `max: 120`); role column is the
*additional* `requireRole` beyond "any admin."

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/admin/drivers` | ADMIN+ | `?onboardingStatus=` filter |
| `GET` | `/admin/drivers/:id` | ADMIN+ | profile + vehicle + documents |
| `POST` | `/admin/drivers/:id/approve` | ADMIN+ | |
| `POST` | `/admin/drivers/:id/reject` | ADMIN+ | `{ reason }` |
| `POST` | `/admin/drivers/:id/suspend` | SUPER_ADMIN | `{ reason }` |
| `POST` | `/admin/drivers/:id/reactivate` | SUPER_ADMIN | |
| `GET` | `/admin/documents` | ADMIN+ | `?reviewStatus=` filter |
| `POST` | `/admin/documents/:id/review` | ADMIN+ | `{ approved, rejectionReason? }` |
| `GET` | `/admin/vehicles` | ADMIN+ | read-only |
| `GET` | `/admin/passengers` | ADMIN+ | |
| `GET` | `/admin/passengers/:id` | ADMIN+ | |
| `GET` | `/admin/rides` | ADMIN+ | `?status=` filter; full history, distinct from Phase 10's `/admin/rides/active` |
| `GET` | `/admin/rides/:id` | ADMIN+ | |
| `GET` | `/admin/payments` | ADMIN+ | `?status=` filter |
| `GET` | `/admin/payments/:id` | ADMIN+ | provider-safe only |
| `GET` | `/admin/ratings` | ADMIN+ | read-only |
| `GET` | `/admin/support/tickets` | ADMIN+ | |
| `GET` | `/admin/support/tickets/:id` | ADMIN+ | full message thread |
| `GET` | `/admin/pricing/configs` | ADMIN+ | full version history |
| `POST` | `/admin/pricing/configs` | SUPER_ADMIN | creates + activates a new version |
| `GET` | `/admin/settings` | ADMIN+ | |
| `PUT` | `/admin/settings/:key` | SUPER_ADMIN | insert-or-update by key |
| `GET` | `/admin/dashboard` | ADMIN+ | one-call summary |
| `GET` | `/admin/earnings/by-driver` | ADMIN+ | per-driver breakdown |
| `GET` | `/admin/audit-logs` | SUPER_ADMIN | most recent 100 |

A route-registration ordering note for maintainers: `adminRouter`
(Phase 6/10/12, owning literal paths like `/admin/rides/active`) is
mounted in `app.ts` *before* any of this phase's `:id`-parametric
routers. Express matches routes in registration order, so a router
owning `/admin/rides/:id` mounted first would swallow the literal
`/admin/rides/active` (matching `:id = "active"`) before it ever reached
the router that actually owns it.

## admin-app frontend

A shared `AdminShell` component (sidebar nav + top bar with identity/
role/logout + the standard signed-out-redirect-and-loading state) now
wraps every section page, replacing the per-page header duplication
earlier phases accumulated. The sidebar hides SUPER_ADMIN-only sections
for a plain ADMIN — again, a convenience only, not the security
boundary. `/live-map` (the fleet map) deliberately stays outside
`AdminShell`'s padded layout, since a full-bleed map and a sidebar don't
share space well; it keeps its own header with a `← Dashboard` link
back to the shell instead.

Every "inspect" list page supports the same status-filter-as-pill-row
pattern the backend's query-string filters expose (drivers, documents,
rides, payments). Driver moderation, document review, and pricing/
settings writes reload their list via a `refreshCount` state bump after
a successful action rather than calling an externally-referenced fetch
function from inside a `useEffect` body — the latter trips
`react-hooks/set-state-in-effect`; keeping the actual `fetch` call
lexically inside the effect (the same shape `/rides` and `/revenue`
already used pre-Phase-14) satisfies the rule without losing the
reload-after-write behavior.

Login now redirects to `/` (the dashboard) instead of `/live-map` on
success, since every other section is reachable from there via the new
nav. `SystemStatusCard` (Phase 0's pre-auth health check) moved from the
old public dashboard onto the login page — the dashboard itself is now
behind auth like every other section, so the login page is the only
place left where an unauthenticated connectivity check makes sense.

## Tests

Three new backend test files against a real PostgreSQL database, driving
full HTTP flows through `createApp()`:

- `adminDrivers.test.ts` — approve/reject/suspend/reactivate transitions
  (including the 409-on-wrong-starting-state case for each), audit
  records written for each, SUPER_ADMIN-vs-ADMIN role gating on
  suspend/reactivate, `?onboardingStatus=` filtering, document
  review (approve, reject-requires-reason, already-reviewed → 409, audit
  record), and vehicle listing.
- `adminInspect.test.ts` — passengers/rides/payments/ratings inspect
  endpoints against a real completed-and-rated-and-paid ride
  (`driveRideToCompleted`, mirroring `ratings.test.ts`'s own fixture):
  list + detail + 404-for-unknown-id for each section, `?status=`
  filtering, and confirming `/admin/rides/active` (Phase 10) still
  resolves correctly alongside the new `/admin/rides/:id`.
- `adminPlatform.test.ts` — support ticket list/detail (oldest-first
  messages, internal notes included), pricing change
  (ADMIN blocked/SUPER_ADMIN allowed, version history, duplicate-name
  409, audit record), settings write (same role split, in-place update
  on a repeat key, audit record), dashboard summary shape, per-driver
  earnings breakdown shape, and audit log listing (SUPER_ADMIN only).

Full repo verification after this phase: lint, typecheck, and a clean
build all pass across every workspace; a from-zero `db:migrate` is
clean; 176 tests passing in `apps/api` (up from 156 before this phase);
admin-app's own unit tests (`SystemStatusCard`, `apiClient`) still pass
unchanged; `next build` produces all 22 admin-app routes with no errors.

## Manual test procedure

1. `npm run db:seed --workspace=packages/database` with
   `SEED_ADMIN_PASSWORD` set, to get `admin@example-dev.test` (ADMIN)
   and `super.admin@example-dev.test` (SUPER_ADMIN) accounts.
2. Start `apps/api` and `apps/admin-app`; log in as the plain ADMIN
   account. Confirm the sidebar has no "Audit Logs" item, and that
   `/drivers/[id]` for an APPROVED driver shows "Suspending a driver
   requires SUPER_ADMIN" instead of a suspend button; `/pricing` and
   `/settings` show their view-only messaging in place of the write
   forms.
3. Log out, log back in as the SUPER_ADMIN account. Confirm all three
   are now visible/usable: suspend an approved driver (reason required),
   confirm it now shows `SUSPENDED`/`OFFLINE`, then reactivate it;
   submit a new pricing config and confirm it becomes the active one in
   the version history; write a system setting and confirm it appears
   in the list.
4. Visit `/drivers/applications` with at least one `PENDING_REVIEW`
   driver seeded; approve one and reject another with a reason; confirm
   both disappear from the queue.
5. Visit `/documents`, filter to `PENDING`, approve one document and
   reject another with a reason; confirm the filter-driven list updates.
6. Complete a ride end-to-end via the passenger/driver apps (or
   directly via HTTP, mirroring `adminInspect.test.ts`), then confirm it
   shows up in `/passengers/[id]`'s ride count, `/rides/all`,
   `/payments`, and — after rating it from both apps — `/ratings`.
7. Visit `/` and confirm the dashboard's counts move after step 6 (a
   manual refresh may be needed — this page fetches once on load).
8. As SUPER_ADMIN, visit `/audit-logs` and confirm every mutating action
   from steps 2-6 produced a row.

## Known limitations

- **Suspending a driver mid-ride does not affect that ride itself** —
  only future availability (`suspendDriver` never touches `rides`). A
  passenger already matched with a driver who gets suspended mid-trip
  will complete that one ride normally.
- **No support-ticket write side yet.** Admin-app can list and inspect
  tickets, but nothing in Stage 1 — passenger-app, driver-app, or
  admin-app — can create one, reply to one, or change its status. That
  arrives with section 18's own phase.
- **Dashboard and per-driver earnings are fetch-once-plus-manual-refresh**,
  not polled — unlike the fleet map/active rides pages, there's no
  strong case for second-by-second freshness on aggregate counts.
- **System settings have no fixed schema or per-key validation** beyond
  "valid JSON" — a typo'd key or malformed value is only ever caught by
  whatever code eventually reads that key, since nothing in Stage 1
  consumes `system_settings` yet.
- **No bulk actions.** Every driver approval/rejection, document review,
  and (implicitly) every other mutation is one row at a time — no
  "approve all pending" button, matching the spec's action list exactly
  as written (all singular).
- **Audit log has no filtering or pagination in the UI** — `GET
  /admin/audit-logs` always returns the most recent 100 rows; an admin
  who needs to search further back has no way to yet.
