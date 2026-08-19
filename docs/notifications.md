# Notification System — Phase 16

## Scope

Section 16: "Create `NotificationProvider` abstraction"; the canonical
event list (ride requested, ride accepted, driver approaching, driver
arrived, ride started, ride completed, payment status, driver approval,
driver rejection, document expiration, support update); "Implement
in-app notifications"; "Add push notification capability when
configuration permits"; and "Do not tightly couple ride logic to a
specific push provider."

No new `notifications` table migration was needed — it (with exactly
the columns this phase needs: `userId`, `type`, `title`, `body`, `data`,
`readAt`, `createdAt`) was already fully defined in Phase 1's schema,
its own comment explicitly anticipating "Phase 16's NotificationProvider
abstraction." This phase's one migration
(`0006_warm_killraven.sql`) adds what wasn't yet there: a `push_tokens`
table (one row per registered device) and
`driver_documents.expiration_notified_at` (the document-expiration
sweep's dedup column).

## `NotificationProvider` abstraction

**`@rideshare/notifications`** — `NotificationProvider.sendPush()`,
scoped to push delivery only; in-app notifications are just database
rows apps/api's `notificationService` owns directly, so this interface
is the entire surface any ride/payment/driver-moderation code path
could possibly be coupled to. In practice none of them are: every call
site goes through `notificationService.notify(...)` (or one of its
per-event typed helpers), never `NotificationProvider` directly —
satisfying "do not tightly couple ride logic to a specific push
provider."

Two implementations:

- **MOCK** (`createMockNotificationProvider`) — always resolves
  `{ status: 'sent' }`, no I/O. The default in every environment here.
- **Real** (`createExpoPushProvider`) — a genuine `fetch` POST to
  Expo's push endpoint (`https://exp.host/--/api/v2/push/send`).
  Unlike every other "real" provider in this codebase (Stripe, a real
  object store, a real background-check vendor), this one is not merely
  aspirational: Expo's push API needs no API key or secret to attempt a
  send, so `createExpoPushProvider()` is buildable and will make live
  HTTP requests. What it doesn't have is a real device to produce or
  verify an Expo push token against in this sandboxed environment — so
  MOCK stays the default even when the real implementation is fully
  functional code, not a stub.

Selected once per process in `apps/api/src/lib/notificationProvider.ts`,
gated by `EXPO_PUSH_ENABLED` (unset or anything other than the literal
string `"true"` means MOCK) — not by credential presence, the way
`paymentProvider.ts` gates on `STRIPE_SECRET_KEY`, because Expo's push
endpoint has no credential to check. The gate exists purely so this
environment's default stays the deterministic MOCK unless someone
explicitly opts in.

## Central `notify()` + one typed helper per event

`apps/api/src/services/notificationService.ts` owns the entire write
path. `notify(userId, type, title, body, data?)`:

1. Inserts a `notifications` row (the in-app notification — the source
   of truth, and the only step that can throw).
2. Looks up every `push_tokens` row for that user (a user can have more
   than one — multiple devices) and calls `notificationProvider.sendPush()`
   for each, in a `try`/`catch` that only logs — a missing device, an
   unreachable Expo endpoint, or any other delivery failure never
   surfaces to the caller.

Eleven typed helpers (`notifyRideRequested`, `notifyRideAccepted`,
`notifyDriverApproaching`, `notifyDriverArrived`, `notifyRideStarted`,
`notifyRideCompleted`, `notifyPaymentStatus`, `notifyDriverApproved`,
`notifyDriverRejected`, `notifyDocumentExpiring`, `notifySupportUpdate`)
wrap `notify()` with the event's fixed `NotificationType` (a stable
`domain.event` string, mirroring the audit log's `action` naming
convention — never inferred from a notification's translatable
title/body text) and a human-readable title/body built from the
caller's already-loaded domain data.

Every call site additionally wraps the whole call in its own
`try`/`catch`/log — the same "must not fail the primary action"
precedent Phase 7's `startMatching` call established — so a
notification failure never fails a ride request, a payment, a driver
approval, or anything else it's attached to.

## Event wiring

| Event | Recipient | Fired from |
|---|---|---|
| `ride.requested` | passenger | `rideService.requestRide`, after the ride reaches `SEARCHING_DRIVER` |
| `ride.accepted` | passenger | `matchingService.handleAccept`, after the atomic accept wins |
| `ride.driver_approaching` | passenger | `rideLifecycleService.markEnRoute` |
| `ride.driver_arrived` | passenger | `rideLifecycleService.markArrived` |
| `ride.started` | passenger | `rideLifecycleService.startTrip` |
| `ride.completed` | passenger | `rideLifecycleService.completeRide` |
| `payment.status` | passenger | `paymentService`'s shared `notifyPaymentOutcome()`, called from `runPaymentAttempt` (both `chargeRideFare` and `retryRidePayment`), `handleStripeWebhookEvent`, and `refundPayment` |
| `driver.approved` | driver | `adminDriverService.approveDriver` |
| `driver.rejected` | driver | `adminDriverService.rejectDriver` (body includes the rejection reason) |
| `document.expiring` | driver | the new document-expiration sweep (`documentService.sweepExpiringDocuments`) |
| `support.update` | ticket owner | the new `POST /admin/support/tickets/:id/messages` (non-internal-note replies only) |

Every ride-lifecycle event targets the **passenger**, never the driver
— the driver already knows the outcome of their own action.
`markPassengerOnboard` (pickup) deliberately has no corresponding event
or notification; the spec's canonical list has no "passenger onboard"
entry.

`rideLifecycleService.driverTransition()` (the shared helper behind
`markEnRoute`/`markArrived`/`markPassengerOnboard`/`startTrip`) takes an
optional notification descriptor so three of its four callers can
trigger a notification using the just-updated row's `passengerId`;
`markPassengerOnboard` passes none. `completeRide` has its own bespoke
body (it doesn't go through `driverTransition`) and fires its own
notification directly, sharing the same lookup/dispatch helper.

`paymentService`'s `notifyPaymentOutcome(record)` is the one choke
point behind all four payment paths — it resolves
`findRideById(record.rideId)` → `findPassengerProfileById(ride.passengerId)`
→ `.userId` and skips silently if the record is still `PENDING`. The
optimistic `runPaymentAttempt` path and the webhook's compare-and-swap
are redundant by design (see `paymentService`'s own comments): whichever
one actually wins the race sends the notification; the loser's call is
a no-op (`markPaymentOutcome*` returns `undefined`), so a ride never
gets two `payment.status` notifications for the same outcome.

## Document-expiration sweep

A new background timer (`apps/api/src/index.ts`,
`DOCUMENT_EXPIRATION_SWEEP_INTERVAL_MS`, default one hour) — same
"lives in `index.ts`, never in `createApp()`" reasoning as Phase 8's
matching sweep, so a supertest suite building `createApp()` directly
never has a background interval ticking during it.

`documentService.sweepExpiringDocuments()` queries
`driver_documents` for `APPROVED` + expiring within the warning window
(the same 30-day definition Phase 15's `countExpiringDocuments`
already established) + `expiration_notified_at IS NULL`. For each
match: send `document.expiring`, then — **only after a successful
send** — stamp `expiration_notified_at` via a compare-and-swap
conditional on it still being `NULL`. A failed send is retried by the
next tick rather than silently marked away; a successful one is never
re-sent, even by a concurrent or repeat sweep. A fresh replacement
upload (Phase 15) always starts a new row with its own `NULL`
`expiration_notified_at`, so a replaced document gets its own warning
cycle rather than inheriting the old one's.

## Admin support reply (new, minimal)

Section 18 (support ticket lifecycle) isn't built yet — Phase 14 only
added read-only admin viewing of `support_tickets`/`support_messages`,
and nothing writes to either table. Rather than leave `support.update`
unwireable, this phase adds exactly one endpoint:
`POST /admin/support/tickets/:id/messages` (`ADMIN`+, same "routine
action" classification as document approve/reject) — `{ body,
isInternalNote? }`. An internal note is never visible to the ticket's
owner, so it fires no notification; a real reply does. Audited
(`support.reply`), same "sensitive admin operations generate audit
records" convention every other mutating admin action follows. This is
deliberately **not** a reimplementation of Section 18: no ticket
creation, no status transitions, no passenger/driver-facing reply UI —
just enough to make `support.update` a genuine, functionally-wired
trigger instead of a notification type nothing can ever fire.
`admin-app`'s `/support/[id]` page gained a reply form (body + internal-
note checkbox) so the endpoint is actually reachable through the app,
not just directly against the API.

## Routes

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/notifications` | PASSENGER/DRIVER | `{ notifications, unreadCount }`, most recent first |
| `POST` | `/notifications/:id/read` | PASSENGER/DRIVER | idempotent; `404` if not found or not the caller's |
| `POST` | `/notifications/read-all` | PASSENGER/DRIVER | marks every unread notification for the caller read |
| `POST` | `/notifications/push-token` | PASSENGER/DRIVER | `{ token, platform? }`, upserts by `token` (re-homes to the calling user if already registered) |
| `DELETE` | `/notifications/push-token?token=` | PASSENGER/DRIVER | scoped to the token's current owner; a non-owner's call is a silent no-op |
| `POST` | `/admin/support/tickets/:id/messages` | ADMIN+ | `{ body, isInternalNote? }`, `support.update` fires only for a non-internal-note reply |

## Client changes

**passenger-app** and **driver-app** (near-identical, each themed to
its own app): a new `NotificationsScreen` (list, most recent first,
unread indicator, tap-to-mark-read, "mark all read"), reachable from a
new bell icon on the home map screen and from Settings (previously a
placeholder explicitly noting "notifications... are added alongside the
phases that introduce something worth configuring" — this is that
phase). A new `PushTokenRegistrar` component, mounted once at the root
of the signed-in navigation tree (not any one screen, so registration
doesn't depend on the user ever visiting a particular screen), requests
notification permission and registers the device's Expo push token via
`lib/pushNotifications.ts`'s `registerForPushNotificationsAsync()` —
which returns `null` (never throws) whenever push isn't actually
available: no physical device, permission denied, or no EAS project
configured. Both apps gained an `expo-notifications` dependency and its
plugin entry in `app.config.ts`.

**admin-app**: `/support/[id]` gained the reply form described above.

## Tests

`apps/api/src/routes/notifications.test.ts` (19 tests), against a real
PostgreSQL database, driving every event through its actual production
code path (never notificationService called directly):

- A full ride walked from request through completion asserts all seven
  ride/payment events landed on the passenger, with `data` payloads
  intact (e.g. `payment.status`'s `{ rideId, status: 'SUCCEEDED' }`).
- A direct `refundPayment()` call asserts its own `payment.status`
  (`REFUNDED`) notification.
- Driver approve/reject assert `driver.approved`/`driver.rejected`
  (including the reason text) land on the driver.
- The expiration sweep: a newly-expiring `APPROVED` document is
  notified exactly once, `expiration_notified_at` is stamped, and a
  repeat sweep does not re-notify; a document outside the warning
  window is never notified.
- Admin support reply: a real reply notifies the ticket owner and
  writes a `support.reply` audit record; an internal note does not
  notify; an empty body is `400`; an unknown ticket is `404`.
- List/read/read-all: a fresh list has every notification unread with
  `unreadCount` matching; marking one read is idempotent and `404`s for
  a mismatched owner or unknown id; mark-all-read zeroes the unread
  count.
- Push tokens: register, re-registering the same token under a
  different user re-homes it (no duplicate row), unregister is scoped
  to the current owner (a non-owner's delete is a silent no-op).

Full repo verification after this phase (including a follow-up
self-review pass — see "Re-review fixes" below): lint, typecheck, and
build all pass across every workspace (including the new
`@rideshare/notifications` package); a from-zero `db:migrate` is clean;
213 tests passing in `apps/api` (up from 194 before this phase);
`packages/notifications` (6 tests) passes on its own; passenger-app and
driver-app's existing unit test suites are unaffected; `next build`
still produces every admin-app route with no errors.

## Re-review fixes

A follow-up self-review against the spec's general conventions (not new
requirements — things this phase's own implementation should already
have matched) found and fixed three gaps:

- **Admin support reply wasn't audited.** Section 14's "sensitive admin
  operations generate audit records" applies to every mutating admin
  action in this codebase; `replyToTicket` was missing a
  `recordAuditLog` call. Fixed — `support.reply`, entity type
  `support_ticket`.
- **`push_tokens.user_id` had no index**, unlike every other
  foreign-key column this codebase queries by (`notifications_user_id_idx`,
  `driver_documents_driver_id_idx`, etc.). Fixed — migration
  `0007_material_micromax.sql`.
- **The admin support reply endpoint had no admin-app UI calling it** —
  functional and tested against the API directly, but unreachable
  through normal app use. Fixed — `/support/[id]` gained a reply form.

## Manual test procedure

1. As a `PASSENGER`, request a ride and walk it through matching,
   accept (as a `DRIVER`), the full lifecycle, and completion. After
   each step, open Notifications (bell icon on the home map, or
   Settings → Notifications) on the passenger side and confirm the
   matching event appears, unread.
2. Tap one notification; confirm it becomes read (the unread dot
   disappears, the unread count decrements). Use "Mark all read" and
   confirm the count reaches zero.
3. As `ADMIN`, approve a `PENDING_REVIEW` driver's application; confirm
   that driver's Notifications screen shows `driver.approved`. Reject a
   different driver with a reason; confirm the rejection notification
   includes that reason text.
4. Manually set an `APPROVED` document's `expires_at` to within 30
   days (or wait for the sweep at its configured interval). Confirm the
   owning driver receives a `document.expiring` notification exactly
   once, even across multiple sweep ticks.
5. Manually insert a `support_tickets` row for a passenger (Section 18
   has no create-ticket UI yet), then as `ADMIN` reply via
   `POST /admin/support/tickets/:id/messages` with `isInternalNote`
   omitted; confirm the passenger receives `support.update`. Reply
   again with `isInternalNote: true`; confirm no new notification
   arrives.
6. On a real device or simulator with push permission grantable,
   observe `PushTokenRegistrar` attempt registration on sign-in (no
   visible UI — check `apps/api` logs / the `push_tokens` table for a
   new row). Set `EXPO_PUSH_ENABLED=true` in `apps/api/.env` and confirm
   `notificationProvider` becomes the real Expo implementation (still
   safe to run with no real token to send to — see Known Limitations).

## Known limitations

- **No real device push delivery is verifiable in this environment.**
  `createExpoPushProvider()` is fully functional, real code — but this
  sandbox has no physical device to produce a real Expo push token, so
  MOCK remains the default (`EXPO_PUSH_ENABLED` unset) and the real
  provider's live HTTP calls are exercised only by
  `packages/notifications`'s own unit tests (a stubbed `fetch`), not by
  an actual delivered push notification.
- **No deep-linking from a notification tap.** `AppNotification.data`
  carries a payload (e.g. `{ rideId }`) intended for future
  deep-linking, but neither `NotificationsScreen` navigates anywhere on
  tap today — it only marks the notification read. The `NotificationType`
  key is deliberately stable and machine-matchable for when that's
  built.
- **The admin support reply endpoint is not Section 18.** No ticket
  creation, no status transitions (`OPEN`/`IN_PROGRESS`/etc. never
  change), no passenger/driver-facing reply UI — see "Admin support
  reply" above. A passenger/driver cannot see or respond to a reply
  anywhere in the app yet, only receive the notification that one
  happened.
- **No unread-count badge outside the Notifications screen itself.**
  The bell icon on each app's home map is a static button, not a live
  badge — checking for unread notifications means opening the screen.
- **Push token cleanup on logout is unwired.** `DELETE
  /notifications/push-token` exists and is tested, but neither app's
  `logout()` calls it — a token stays registered to a signed-out user
  until overwritten by a later registration (e.g. someone else signing
  in on the same device) or manually removed.
