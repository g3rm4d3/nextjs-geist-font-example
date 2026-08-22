# API Reference — Phase 24

## Scope

A complete endpoint reference for `apps/api`, one of the required docs
for Stage 1 Final Validation. This is a map of *what exists and where*
— method, path, who may call it, and a one-line purpose — not a
request/response schema reference; each phase's own doc
(`docs/pricing.md`, `docs/ride-state-machine.md`, `docs/payments.md`,
...) covers the request/response shapes and business rules for its
domain in depth, and `packages/types`/`packages/validation` are the
actual source of truth for every request/response TypeScript shape.

## Conventions

- **Base URL**: `env.apiUrl` (each client app's own config) + the path
  below, e.g. `POST /auth/login`.
- **Auth**: `Bearer <accessToken>` in the `Authorization` header,
  obtained from `/auth/login` or a `/auth/*/register` endpoint (see
  `docs/authentication.md`). "Auth" below is the role the endpoint
  requires; "—" means no authentication.
- **Response envelope**: every response is
  `{ success: true, data, requestId }` or
  `{ success: false, error: { code, message, details? }, requestId }`
  (`packages/types`' `ApiResponse<T>` — see `docs/architecture.md`).
- **Rate limiting**: every route below sits behind a limiter
  appropriate to its sensitivity (auth endpoints strictest, read-only
  admin endpoints most permissive) — see `docs/security.md`'s rate
  limiting section for the policy; not re-itemized per endpoint here.
- Money is always integer cents; a `:id` segment is always a UUID.

## Health & readiness

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Liveness — is the process up. |
| GET | `/ready` | — | Readiness — can this instance serve traffic (DB reachable). |

## Authentication (`docs/authentication.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/passengers/register` | — | Create a passenger account, returns tokens. |
| POST | `/auth/drivers/register` | — | Create a driver account (starts `PENDING` onboarding). |
| POST | `/auth/login` | — | Email+password login for any role. |
| POST | `/auth/refresh` | — | Exchange a refresh token for a new access token. |
| POST | `/auth/logout` | — | Revoke a refresh token (session). |
| POST | `/auth/password-reset/request` | — | Issue a password reset token (no-op response either way — never confirms an email exists). |
| POST | `/auth/password-reset/confirm` | — | Consume a reset token, set a new password, revoke all sessions. |
| GET | `/auth/me` | any signed-in | Current user's own identity/role. |

## Passenger self-service

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/passengers/me` | PASSENGER | Own profile. |
| PATCH | `/passengers/me/payment-method` | PASSENGER | Set the default Stripe TEST MODE payment method. |

## Driver self-service

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/drivers/me` | DRIVER | Own driver identity. |
| GET | `/drivers/me/profile` | DRIVER | Own driver profile + onboarding status. |
| PUT | `/drivers/me/vehicle` | DRIVER | Create/update the driver's vehicle. |
| POST | `/drivers/me/submit-application` | DRIVER | Move onboarding from draft to `PENDING` review. |
| PATCH | `/drivers/me/availability` | DRIVER | Go `ONLINE`/`OFFLINE` (requires `APPROVED`). |
| POST | `/drivers/me/location` | DRIVER | Report current GPS position. |

## Driver offers — matching (`docs/matching.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/drivers/me/offer` | DRIVER | Current open ride offer, or `null`. |
| POST | `/drivers/me/offer/:id/accept` | DRIVER | Accept an offer (atomic — exactly one winner). |
| POST | `/drivers/me/offer/:id/decline` | DRIVER | Decline; matching advances to the next candidate. |

## Driver ride lifecycle (`docs/ride-state-machine.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/drivers/me/rides/:id/en-route` | DRIVER | `DRIVER_ASSIGNED` → `DRIVER_EN_ROUTE`. |
| POST | `/drivers/me/rides/:id/arrived` | DRIVER | → `DRIVER_ARRIVED`. |
| POST | `/drivers/me/rides/:id/picked-up` | DRIVER | → `PASSENGER_ONBOARD`. |
| POST | `/drivers/me/rides/:id/start` | DRIVER | → `IN_PROGRESS`. |
| POST | `/drivers/me/rides/:id/complete` | DRIVER | → `COMPLETED`; computes final fare, auto-charges TEST payment, records earnings. |
| POST | `/drivers/me/rides/:id/cancel` | DRIVER | Cancel; returns the ride to matching or ends it, depending on stage. |
| GET | `/drivers/me/rides/:id` | DRIVER | The driver's own view of one ride. |
| POST | `/drivers/me/rides/:id/rating` | DRIVER | Driver rates the passenger (only once `COMPLETED`). |
| GET | `/drivers/me/rides/:id/ratings` | DRIVER | Both directions of a ride's ratings. |

## Driver earnings (`docs/payments.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/drivers/me/earnings/summary` | DRIVER | Today/week/month totals. |
| GET | `/drivers/me/earnings/history` | DRIVER | Per-ride earnings ledger. |

## Driver documents (`docs/document-management.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/drivers/me/documents` | DRIVER | Upload a document (base64 JSON body). |
| GET | `/drivers/me/documents` | DRIVER | List own documents + review status. |

## Rides — passenger-facing (`docs/ride-state-machine.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/rides` | PASSENGER | Request a ride (idempotent on `idempotencyKey`); triggers matching. |
| GET | `/rides/:id` | PASSENGER | The passenger's own view of one ride. |
| GET | `/rides/:id/driver` | PASSENGER | Assigned driver's identity/vehicle/live location, or `null`. |
| POST | `/rides/:id/cancel` | PASSENGER | Cancel (legal up through `DRIVER_ARRIVED`). |
| GET | `/rides/:id/payment` | PASSENGER | Current/latest payment attempt for the ride. |
| POST | `/rides/:id/payment/retry` | PASSENGER | Retry a failed payment. |
| POST | `/rides/:id/rating` | PASSENGER | Passenger rates the driver. |
| GET | `/rides/:id/ratings` | PASSENGER | Both directions of a ride's ratings. |

## Route preview & pricing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/routes/preview` | any signed-in | Distance/duration between two points (`packages/maps`). |
| POST | `/pricing/estimate` | any signed-in | Fare estimate for a route (`packages/pricing`). |

## Payments (`docs/payments.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/payments/test-methods` | PASSENGER | Catalog of selectable Stripe TEST MODE payment method ids. |
| POST | `/webhooks/stripe` | Stripe signature | Stripe TEST MODE webhook delivery (raw body, signature-verified — never a bearer token). |

## Notifications (`docs/notifications.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/notifications` | any signed-in | Own notification list + unread count. |
| POST | `/notifications/:id/read` | any signed-in | Mark one notification read. |
| POST | `/notifications/read-all` | any signed-in | Mark every notification read. |
| POST | `/notifications/push-token` | any signed-in | Register an Expo push token. |
| DELETE | `/notifications/push-token` | any signed-in | Unregister (e.g. on logout). |

## Support (`docs/support-system.md`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/support/tickets` | PASSENGER or DRIVER | Open a support ticket. |
| GET | `/support/tickets` | PASSENGER or DRIVER | Own tickets. |
| GET | `/support/tickets/:id` | PASSENGER or DRIVER (owner only) | One ticket's full thread. |

## Admin — users, dashboard, fleet, active rides

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/users` | ADMIN | User directory. |
| GET | `/admin/drivers/locations` | ADMIN | Live fleet positions (`docs/location.md`). |
| GET | `/admin/rides/active` | ADMIN | Every non-terminal ride. |
| GET | `/admin/revenue` | ADMIN | Platform-wide today/week/month/all-time TEST revenue. |
| GET | `/admin/dashboard` | ADMIN | Top-line operational summary. |
| GET | `/admin/metrics` | ADMIN | In-process request performance metrics (`docs/troubleshooting.md`). |

## Admin — people & moderation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/passengers` | ADMIN | Passenger directory. |
| GET | `/admin/passengers/:id` | ADMIN | One passenger's detail (rides, payments, ratings). |
| GET | `/admin/drivers` | ADMIN | Driver directory (filterable by onboarding status). |
| GET | `/admin/drivers/:id` | ADMIN | One driver's full detail. |
| POST | `/admin/drivers/:id/approve` | ADMIN | Approve onboarding. |
| POST | `/admin/drivers/:id/reject` | ADMIN | Reject onboarding. |
| POST | `/admin/drivers/:id/suspend` | ADMIN | Suspend an approved driver. |
| POST | `/admin/drivers/:id/reactivate` | ADMIN | Reactivate a suspended driver. |
| POST | `/admin/drivers/:id/background-check` | ADMIN | Trigger a MOCK background check run (`docs/document-management.md`). |
| GET | `/admin/vehicles` | ADMIN | Vehicle directory. |
| GET | `/admin/documents` | ADMIN | Document review queue. |
| POST | `/admin/documents/:id/review` | ADMIN | Approve/reject a document. |
| POST | `/admin/documents/:id/request-replacement` | ADMIN | Ask a driver to re-upload. |

## Admin — operations

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/rides` | ADMIN | All rides, filterable. |
| GET | `/admin/rides/:id` | ADMIN | One ride's full detail (pickup/destination/status/fare). |
| GET | `/admin/payments` | ADMIN | All payment records. |
| GET | `/admin/payments/:id` | ADMIN | One payment's detail. |
| GET | `/admin/ratings` | ADMIN | All ratings. |
| GET | `/admin/earnings/by-driver` | ADMIN | Per-driver earnings drill-down. |
| GET | `/admin/support/tickets` | ADMIN | All support tickets. |
| GET | `/admin/support/tickets/:id` | ADMIN | One ticket's full thread. |
| POST | `/admin/support/tickets/:id/messages` | ADMIN | Reply into a ticket. |
| PATCH | `/admin/support/tickets/:id/status` | ADMIN | Change ticket status. |

## Admin — platform configuration

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/pricing/configs` | ADMIN | List pricing configs (only one `active` at a time). |
| POST | `/admin/pricing/configs` | SUPER_ADMIN | Create + activate a new pricing config. |
| GET | `/admin/settings` | ADMIN | System settings (read). |
| PUT | `/admin/settings/:key` | SUPER_ADMIN | Upsert one system setting (write). |
| GET | `/admin/audit-logs` | SUPER_ADMIN | Immutable log of every sensitive admin mutation. |

## Known limitations

- No OpenAPI/Swagger spec is generated — this table is hand-maintained
  against `apps/api/src/routes/*.ts`; `packages/validation`'s Zod
  schemas are the actual runtime source of truth for every request
  shape, and `packages/types` for every response shape.
- No API versioning scheme exists (no `/v1/` prefix) — acceptable for
  a single-Stage-1-deployment API with no external consumers yet; a
  real launch would want one before any breaking change.
