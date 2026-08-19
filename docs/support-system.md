# Support System — Phase 18

## Scope

Section 18: passenger app and driver app can create a support ticket,
which can reference a ride; the admin app can review, reply, add an
internal note, and change status; states are `OPEN` / `IN_PROGRESS` /
`WAITING_USER` / `RESOLVED` / `CLOSED`.

Most of the admin-facing half already existed from Phase 14 (ticket
list/detail read model) and Phase 16 (the reply endpoint, internal
notes, the `support.update` notification). This phase's job was the two
pieces that were still missing: letting a passenger or driver actually
*create* a ticket and see their own tickets (there was previously no
writer of `support_tickets` at all — Phase 14 seeded them directly), and
letting an admin change a ticket's status. No schema migration was
needed — `support_tickets.status` and `support_messages` already had
everything this phase's tables needed.

## Ticket lifecycle — no fixed transition graph

Unlike a ride (a strictly forward-only state machine gated by atomic
compare-and-swap `UPDATE`s), a support ticket's five states have no
described transition graph in the spec. `supportRepository.updateTicketStatus`
is therefore a plain, unconditional `UPDATE` — an admin can move a
`RESOLVED` ticket back to `IN_PROGRESS`, or straight from `OPEN` to
`CLOSED`, with no path restrictions. This is deliberate and is tested
directly (`'allows any status to move to any other status'`).

A newly created ticket always starts `OPEN`; the client never gets to
choose otherwise.

## Ownership and the ride reference

`createTicket` accepts an optional `rideId`. `supportService.requireOwnedRideId`
re-validates it server-side (section 3's server-authoritative principle):
the ride must exist and belong to the caller, either as its passenger or
its driver. A `rideId` that doesn't exist or belongs to someone else is
rejected with a field-level `400 VALIDATION_ERROR` (`details: { rideId:
[...] }`), not silently dropped and not a `403` — this is a
client-supplied request-body reference, not a path-based resource
lookup, so the codebase's usual not-found-not-forbidden pattern (which
applies to *fetching* a resource by id) doesn't apply here; there is
nothing to avoid confirming the existence of, since the caller supplied
the id themselves.

Listing and viewing tickets (`GET /support/tickets`, `GET
/support/tickets/:id`) *do* follow the not-found-not-forbidden pattern:
a ticket that exists but isn't the caller's own returns a plain `404`,
same as everywhere else in the codebase a caller might otherwise probe
for another user's resource by id.

## What a ticket owner sees vs. what an admin sees

`SupportMessage` (the user-facing shape, `packages/types/src/support.ts`)
has no author name or identity field — only `isFromSupport: boolean`.
This is deliberate: `ADMIN`/`SUPER_ADMIN` accounts have no first/last
name in this schema, only an email, and showing a passenger or driver
the replying admin's email was judged an unnecessary identity leak. The
admin-facing `AdminSupportMessage` (Phase 16) is unaffected and still
exposes `authorName` — that's an admin looking at their own reply.

Internal notes are excluded at the query level, not filtered downstream:
`supportRepository.listUserVisibleMessagesForTicket` bakes `isInternalNote
= false` directly into its `WHERE` clause, so an internal note can never
reach a ticket owner's response "regardless of what the service layer
does with the result" (see the function's own comment). Tested directly
(`'excludes internal notes from the user-facing thread'`).

## Admin status change

`PATCH /admin/support/tickets/:id/status` (`ADMIN` or `SUPER_ADMIN` —
routine/reversible, same classification as reply and
request-replacement): reads the ticket's prior state, applies the
unconditional status update, records an audit log entry
(`support.change_status`, `before`/`after` status in metadata), and — best
effort, same as everywhere else a mutation triggers a notification —
fires `notifySupportUpdate(ticket.userId, ticketId)`.

That notification function is not new. Phase 16 built it for a reply; a
status change is reasoned to be just as much "an update to your ticket"
as a new message is, so both triggers now fire the same `support.update`
event rather than the notification type catalog growing a second entry
for what the user experiences identically either way.

## Routes

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| `POST` | `/support/tickets` | `PASSENGER`, `DRIVER` | Creates a ticket, `OPEN`, optional `rideId` |
| `GET` | `/support/tickets` | `PASSENGER`, `DRIVER` | Caller's own tickets, most recent first |
| `GET` | `/support/tickets/:id` | `PASSENGER`, `DRIVER` | Caller's own ticket + message thread (404 if not theirs) |
| `PATCH` | `/admin/support/tickets/:id/status` | `ADMIN`+ | New this phase |

All three passenger/driver routes sit behind a new `supportLimiter` (20
requests/minute per user), mirroring the reasoning behind the existing
`documentLimiter`. The two admin routes (`GET`/`POST` messages, unchanged
from Phase 14/16) and the new `PATCH` route share the existing
admin-support router and its existing rate limiting.

## Client changes

**passenger-app** and **driver-app** (identical shape in both — a
support ticket isn't a role-specific resource):

- `SupportScreen` — previously an honest placeholder ("there's nowhere
  for a message submitted here to go"), now a real list of the signed-in
  user's own tickets with a status badge, refetching on screen focus.
- `NewSupportTicketScreen` — subject / body / an optional, manually-typed
  ride-ID field. No ride picker: neither app has a "list my past rides"
  endpoint yet (`RideHistoryScreen` in passenger-app is itself still a
  placeholder), and building one was judged out of this phase's literal
  scope. The backend re-validates ownership regardless of what's typed
  in.
- `SupportTicketDetailScreen` — read-only: subject, status, and the
  message thread as chat bubbles (self vs. support). No reply box in
  either app — see Known Limitations.

**admin-app**: `/support/[id]` gained a status `<select>` next to the
existing reply form, wired to the new `changeSupportTicketStatus`
`apiClient` function (`PATCH`). Choosing a new value immediately submits
it and refetches the ticket.

## Tests

`apps/api/src/routes/support.test.ts` (16 tests), against a real
PostgreSQL database:

- Ticket creation: no ride reference; a passenger's own ride; a driver's
  own ride; rejecting another passenger's ride (`400`); rejecting a
  nonexistent ride (`400`); rejecting an empty subject/body (`400`).
- Listing: only the caller's own tickets are returned.
- Detail: `404` for another user's ticket and for an unknown id;
  internal notes are excluded from the user-facing thread.
- Admin status change: audits the change, fires the notification,
  allows any-status-to-any-status, is available to plain `ADMIN` (not
  just `SUPER_ADMIN`), rejects an invalid status value (`400`), `404`s an
  unknown ticket, and is blocked for a `PASSENGER` (`403`).
- End-to-end: a ticket a passenger creates is immediately visible to an
  admin via the existing `GET /admin/support/tickets` list.

Full repo verification after this phase: lint, typecheck, and build all
pass across every workspace (including a clean `next build` for
admin-app); a from-zero `db:migrate` is unaffected (no new migration);
240 tests passing in `apps/api` (up from 224 before this phase);
passenger-app (26 tests) and driver-app (25 tests) unit suites both
green.

## Manual test procedure

1. As a `PASSENGER`, open Support → New ticket, submit one with no ride
   ID. Confirm it appears in the ticket list as `OPEN` and its detail
   view shows your own opening message.
2. Submit a second ticket referencing a real ride ID that belongs to you
   (copy one from an earlier ride). Confirm it's accepted. Try again with
   a ride ID that isn't yours (or a random UUID) — confirm a clear `400`
   and the form doesn't navigate away.
3. As a `DRIVER`, repeat step 1/2 from the driver app.
4. As an `ADMIN`, open `/support`, find one of the tickets just created,
   open it, and send a reply. Confirm the ticket owner's app shows the
   reply on next refresh (pull back to the ticket list and back in, or
   revisit the ticket screen).
5. As the same `ADMIN`, add an internal note on the same ticket. Confirm
   it shows up in the admin view (amber-highlighted) but never appears in
   the passenger/driver app's view of that ticket.
6. Still as `ADMIN`, change the ticket's status via the new dropdown
   (e.g. `OPEN` → `IN_PROGRESS` → `RESOLVED` → back to `OPEN`). Confirm
   each change persists on reload and the ticket owner's app reflects the
   new status.
7. Confirm a `PASSENGER`/`DRIVER` token gets `403` calling the admin
   status-change endpoint directly.

## Known limitations

- **No passenger/driver-facing reply.** Section 18's spec text lists
  "reply" only under "Admin App," not "Passenger App and Driver App" —
  read literally rather than extending Phase 16's speculative note about
  a future two-way thread. A ticket owner can only ever open a ticket and
  read the resulting thread; if they need to add more information, they
  currently have to open a new ticket. Adding a genuine two-way reply
  would be a natural, self-contained follow-up, not attempted here to
  stay inside this phase's literal scope.
- **No ride picker UI.** The ride reference on ticket creation is a
  manually-typed ride ID in both apps, not a list of the user's own past
  rides to choose from — neither app has that list endpoint yet.
- **No ticket search/filtering on the client side** beyond what already
  existed in admin-app from Phase 14 — the new passenger/driver ticket
  list has no pagination or filtering; Stage 1 test data volumes make
  this a non-issue for now.
- **Status changes are unbounded.** Any status can move to any other
  status with no guardrail (e.g. nothing stops re-opening a `CLOSED`
  ticket the instant after closing it) — this is the deliberate reading
  of the spec's flat five-state list with no described transition graph,
  not an oversight.
