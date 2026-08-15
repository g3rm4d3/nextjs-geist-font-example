# Driver Document Management — Phase 15

## Scope

Section 15: "Implement secure document system" for the four document
types (Driver License, Vehicle Registration, Insurance, Profile Photo);
track document type, upload date, expiration date, review status,
reviewer, review date, and rejection reason; admin actions approve /
reject / request replacement; "create internal expiration warnings";
and `BackgroundCheckProvider` remaining MOCK (section 13).

No new document-table migration was needed — `driver_documents` (with
exactly this column set) was already fully defined in Phase 1's schema
anticipating this phase, and Phase 14 was the first to read/write it
(admin-side review only). This phase adds the piece Phase 14 didn't:
the driver's own upload, "request replacement" as a third review
outcome, expiration warnings, and `BackgroundCheckProvider`. One
migration (`0005_lean_silver_surfer.sql`) adds `REPLACEMENT_REQUESTED`
to the `document_review_status` enum and a new `background_checks`
table.

## Two new provider abstractions

Section 13 lists `StorageProvider` and `BackgroundCheckProvider`
alongside `MapProvider`/`PaymentProvider`/`NotificationProvider` as
external-service abstractions "reasonable" to introduce where a real
vendor might sit behind them later. This phase is the first to need
either, so both get their own package, mirroring `@rideshare/maps`'s
`RouteProvider` and `@rideshare/payments`'s `PaymentProvider`:

- **`@rideshare/storage`** — `StorageProvider.store()`/`getUrl()`/
  `delete()`. The MOCK implementation keeps every stored file's bytes
  in an in-memory `Map` keyed by a generated `storageKey`; `getUrl()`
  reconstructs a `data:` URI from what it stored rather than returning
  a signed URL (there's no real object store to sign a URL against).
  In-memory means content doesn't survive a process restart and isn't
  shared across API instances — an accepted Stage 1 limitation, never
  something a real deployment would rely on.
- **`@rideshare/screening`** — `BackgroundCheckProvider.runCheck()`.
  Unlike every other provider abstraction in this codebase, there is
  **no real implementation to build alongside the MOCK one**: section
  13 states "BackgroundCheckProvider = MOCK ONLY," and section 17's
  "items that must remain outside Stage 1" list explicitly forbids
  "real background checks," marking any future real integration point
  `[BACKGROUND CHECK INTEGRATION REQUIRED]`. The MOCK provider is
  deterministic (always `PASSED`) except for one documented test hook —
  a license number starting with `mock-fail-` (case-insensitive) always
  returns `FAILED` — the same "magic value drives the outcome" pattern
  `@rideshare/payments`'s `TEST_PAYMENT_METHODS` already established for
  exercising a failure path without randomness.

Both are wired as a single shared instance per process
(`apps/api/src/lib/storageProvider.ts` /
`apps/api/src/lib/backgroundCheckProvider.ts`), same shape as
`paymentProvider.ts`/`mapProvider.ts`.

## Driver upload

`POST /drivers/me/documents` accepts `{ documentType, contentBase64,
contentType, expiresAt? }`. The file bytes go through
`storageProvider.store()` first; only the opaque `storageKey` it
returns is ever written to `driver_documents` — the row never holds a
raw path or the bytes themselves. Every upload inserts a new row,
`PENDING` by default; nothing supersedes or deletes an earlier upload
of the same type, so a driver's full document history stays intact for
an admin to review (`GET /drivers/me/documents` returns every upload,
most recent first — the client is expected to show only the latest per
type, which is what driver-app's `DocumentsScreen` does).

The request body carries the file as base64 JSON rather than a
multipart upload — this API has no multipart middleware, and Stage 1's
documents are small enough (a license photo, an insurance PDF) that a
single JSON field is simplest. `express.json()`'s body limit was raised
from 1mb to 8mb specifically to fit this (every other route's payloads
are tiny by comparison).

## Admin document actions: approve, reject, request replacement

Approve/reject (Phase 14) and "request replacement" (this phase) are
three distinct outcomes of reviewing a document, not one action with a
flag:

- **Approve / reject**: `PENDING -> APPROVED`/`REJECTED` only —
  `documentsRepository.reviewDocument`'s compare-and-swap, unchanged
  from Phase 14.
- **Request replacement**: `PENDING` *or* `APPROVED ->
  REPLACEMENT_REQUESTED` — distinct from reject because the document
  isn't being turned down outright, it just needs a fresh upload (the
  shot is fine but the document is about to expire, or the photo needs
  to be retaken). Allowing it from `APPROVED` (not just `PENDING`) is
  what makes it the operational response to an expiration warning: an
  admin sees a document expiring soon and flags it for replacement
  without first having to reject an otherwise-valid, currently-approved
  document.

All three are `ADMIN`+ (routine moderation, the same classification
Phase 14 gave approve/reject) and generate an audit record
(`document.approve`/`document.reject`/`document.request_replacement`).

## Internal expiration warnings

"Create internal expiration warnings" is read as **admin-facing**, not
a notification pushed to anyone — Phase 16's `NotificationProvider` is
the future home for anything driver-facing. This phase adds:

- `AdminDashboardSummary.expiringDocumentsCount` — `APPROVED` documents
  expiring within 30 days (an already-expired document counts too; it
  needs *more* urgency, not less).
- `GET /admin/documents?expiringWithinDays=N` — the drill-down an admin
  clicks into from that dashboard number. When `expiringWithinDays` is
  set and `reviewStatus` isn't explicitly overridden, the filter
  implies `reviewStatus = APPROVED` — matching the dashboard count's own
  restriction, so the number an admin sees and the list they click
  through to stay consistent. (A `PENDING` document with a near
  `expiresAt` isn't "in service" yet, so it isn't operationally urgent
  in the same way.)

Both filters can combine (`?reviewStatus=APPROVED&expiringWithinDays=30`
is exactly what the bare `expiringWithinDays=30` shorthand already
means).

## BackgroundCheckProvider, wired into driver moderation

`POST /admin/drivers/:id/background-check` — `ADMIN`+ (not
`SUPER_ADMIN`-gated; classified the same as approve/reject/document
review, not suspend/pricing/settings). Looks up the driver's name and
license, calls `backgroundCheckProvider.runCheck()`, and records the
result as a new row in `background_checks` (every past run stays in the
table — an admin can see history, not just the latest). The audit log
gets a `driver.background_check` entry.

`GET /admin/drivers/:id` (inspect driver) now includes
`latestBackgroundCheck` — the most recent run, or `null` if none has
ever been triggered for that driver. There is no automatic trigger
anywhere in this phase (e.g. on document approval or application
submission) — running a check is always an explicit admin action,
since the spec doesn't tie it to a specific lifecycle moment and an
unprompted MOCK "check" would be a false signal to bake into the
approval flow.

## Routes

All new/changed routes, in addition to Phase 14's existing admin
document routes:

| Method | Path | Role | Notes |
|---|---|---|---|
| `POST` | `/drivers/me/documents` | DRIVER | `{ documentType, contentBase64, contentType, expiresAt? }`, `201` |
| `GET` | `/drivers/me/documents` | DRIVER | every upload, most recent first |
| `POST` | `/admin/documents/:id/request-replacement` | ADMIN+ | `{ reason }`, `PENDING`/`APPROVED` only |
| `GET` | `/admin/documents` | ADMIN+ | now also accepts `?expiringWithinDays=` |
| `POST` | `/admin/drivers/:id/background-check` | ADMIN+ | `201`, always MOCK |

## Client changes

**driver-app**: `DocumentsScreen` (previously an honest placeholder,
"built in Phase 15") is now functional — one card per document type
showing the latest upload's status/expiration/rejection-or-replacement
reason, and an "Upload" (or "Upload replacement") button that opens
`expo-image-picker`'s library picker with `base64: true` and posts
straight through. A new `expo-image-picker` dependency was added
(mirroring how `expo-location` was added in Phase 5), with its own
plugin config in `app.config.ts` for the photo-library and camera
permission strings.

**admin-app**: `/documents` gains a "Request replacement" button
(available whenever "Approve"/"Reject" would be, plus for `APPROVED`
documents) and an "Expiring within 30 days" filter pill.
`/drivers/[id]` gains a "Background check" card showing the latest
result and a "Run background check" button. The dashboard (`/`) gains
a "Documents expiring soon" stat card.

## Tests

`apps/api/src/routes/documentManagement.test.ts` (18 tests), against a
real PostgreSQL database:

- Driver upload + list (including a document type with no `expiresAt`,
  invalid `documentType`/malformed base64 rejected with `400`, a second
  upload of the same type not overwriting the first, and role-gating a
  passenger away from the endpoints).
- Admin "request replacement": missing-reason `400`, successful
  transition + audit record, `409` from an already-rejected document,
  `404` for an unknown document id.
- The expiration filter: a `PENDING` document with a near `expiresAt`
  doesn't show up in `?expiringWithinDays=30` until approved; a too-
  narrow window excludes it again; a non-numeric `expiringWithinDays`
  is `400`; the dashboard's `expiringDocumentsCount` is present and
  numeric.
- `BackgroundCheckProvider`: defaults to `PASSED` and audits; the
  `mock-fail-` license prefix deterministically returns `FAILED`;
  `latestBackgroundCheck` is `null` before any run and reflects the
  latest result after one; available to a plain `ADMIN` (not
  `SUPER_ADMIN`-gated); `404` for an unknown driver; `403` for a
  passenger.

Full repo verification after this phase: lint, typecheck, and build all
pass across every workspace (including the two new packages); a
from-zero `db:migrate` is clean; 194 tests passing in `apps/api` (up
from 176 before this phase); `packages/storage` (6 tests) and
`packages/screening` (4 tests) both pass on their own; driver-app and
admin-app's existing unit test suites are unaffected; `next build`
still produces every admin-app route with no errors.

## Manual test procedure

1. As a `DRIVER`, open Documents in driver-app. Upload a photo for
   Driver License; confirm it appears "Under review."
2. As `ADMIN` in admin-app, visit `/documents`, filter to `PENDING`,
   and confirm the upload appears with the driver's name. Approve it.
3. Re-upload a new Driver License photo as the same driver (a second
   PENDING row for the same type). As `ADMIN`, use "Request
   replacement" with a reason instead of approve/reject; confirm the
   driver-app card now shows "Replacement requested" with that reason.
4. Seed or manually set an `APPROVED` document's `expires_at` to within
   30 days. Confirm it appears on `/documents` with the "Expiring
   within 30 days" filter active, and that the dashboard's "Documents
   expiring soon" count reflects it.
5. On `/drivers/[id]` for that driver, click "Run background check."
   Confirm the card shows `PASSED` and a timestamp. Manually set that
   driver's `license_number` to start with `mock-fail-` and run the
   check again; confirm it now shows `FAILED`.
6. As a plain `ADMIN` (not `SUPER_ADMIN`), confirm the background-check
   button is still available (unlike suspend/reactivate, which are
   SUPER_ADMIN-gated on the same page).

## Known limitations

- **Storage is in-memory and MOCK only.** Uploaded document content
  does not survive an `apps/api` process restart, and there is no real
  provider (S3, GCS, etc.) implemented — only the abstraction exists,
  ready to swap in later.
- **No real background check, ever, in Stage 1.** `BackgroundCheckProvider`
  has exactly one implementation and it always will while this platform
  stays at Stage 1 — see the `[BACKGROUND CHECK INTEGRATION REQUIRED]`
  marker.
- **Background checks are never automatic.** Nothing in this phase
  triggers a check on document approval, application submission, or
  any other lifecycle event — it is always an explicit admin action.
- **No document content is ever viewable through the API.** Neither the
  driver-facing nor admin-facing document endpoints expose a URL/data
  URI for a stored document in this phase — an admin reviewing a
  document currently only sees its metadata (type, dates, status), not
  the image itself. A follow-up phase would need to add a dedicated
  "view document" endpoint if that becomes necessary.
- **Expiration warnings are a count and a filter, not a notification.**
  Nothing proactively alerts an admin — they have to visit the
  dashboard or documents page to see it. Actually pushing a warning is
  Phase 16's `NotificationProvider` territory.
