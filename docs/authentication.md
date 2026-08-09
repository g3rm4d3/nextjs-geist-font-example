# Authentication & Authorization — Phase 2

> **Scope note:** this phase is backend-only by design. `apps/api` gets a
> complete, tested authentication and authorization system; none of the
> three client apps get login/register *screens* yet. Phase 3
> ("Passenger App Core") and Phase 5 ("Driver App Core") explicitly list
> "Authentication" / "Login" / "Registration" as their own screens to
> build; Phase 14 (Admin App expansion) doesn't list a login screen at
> all, so an admin login page — if wanted before Phase 14 — would be a
> deliberate small follow-up, not an accidental gap.

## Who can authenticate, and how

| App | Can register via the API? | Login endpoint |
| --- | --- | --- |
| Passenger | Yes — `POST /auth/passengers/register` | `POST /auth/login` (shared) |
| Driver | Yes — `POST /auth/drivers/register` | `POST /auth/login` (shared) |
| Admin | **No public registration endpoint exists.** Provisioned directly in the database — see "Provisioning the first admin" below. | `POST /auth/login` (shared) |

`POST /auth/login` is role-agnostic on purpose: it looks up the account by
email and returns whatever role that account has. There is nothing an
admin's login flow does differently at the network level — the privilege
comes entirely from the `role` embedded in the signed access token the
server issues, never from anything the client asserts.

## Endpoints

| Method & path | Auth required | Purpose |
| --- | --- | --- |
| `POST /auth/passengers/register` | none | Create a PASSENGER account + `passenger_profiles` row; returns tokens |
| `POST /auth/drivers/register` | none | Create a DRIVER account + `driver_profiles` row (`onboarding_status = DRAFT`); returns tokens |
| `POST /auth/login` | none | Verify credentials; returns tokens |
| `POST /auth/refresh` | none (refresh token in body) | Rotate a refresh token for a new access/refresh pair |
| `POST /auth/logout` | none (refresh token in body) | Revoke a refresh token |
| `POST /auth/password-reset/request` | none | Issue a password reset token for an email, if that account exists |
| `POST /auth/password-reset/confirm` | none (reset token in body) | Set a new password; revokes all of that user's sessions |
| `GET /auth/me` | access token | Return the caller's own account (role, active flag, driver onboarding status if applicable) |
| `GET /passengers/me` | access token, role PASSENGER | Same as `/auth/me`, scoped — exists to prove role gating works (see Testing) |
| `GET /drivers/me` | access token, role DRIVER | Same, scoped to DRIVER |
| `GET /admin/users` | access token, role ADMIN or SUPER_ADMIN | Minimal user listing — exists to prove admin gating works; real user management is Phase 14 |

Every response uses the same `ApiSuccessResponse` / `ApiErrorResponse`
envelope as the rest of the API (see `docs/architecture.md`).

## Token design

Two different token types, deliberately:

- **Access token** — a short-lived (`JWT_ACCESS_TOKEN_TTL`, default 15
  minutes) signed JWT (`HS256`, `JWT_ACCESS_SECRET`). Carries `sub`
  (user id) and `role`. Stateless: the server never queries the database
  to trust one, which is exactly why it must stay short-lived — nothing
  server-side can revoke an individual access token before it expires.
- **Refresh token** — an opaque 384-bit random value (`node:crypto
  randomBytes(48)`, base64url-encoded), *not* a JWT. Only its SHA-256
  hash is stored, in the `sessions` table (`packages/database`). This is
  what makes real logout and revocation possible: revoking a session is
  an `UPDATE sessions SET revoked_at = now() ...`, not something you can
  do to a stateless JWT.

**Rotation + reuse detection.** Every `POST /auth/refresh` call revokes
the refresh token it was given and issues a brand new pair. If a
already-revoked refresh token is ever presented again — which should
never happen in normal use, since the client always moves to the newest
token — that's treated as a signal the token was stolen and the *entire*
session family for that user is revoked defensively (see
`authService.refresh` in `apps/api/src/services/authService.ts`).
Verified manually: rotate a token, replay the old one (rejected), then
try the token that legitimately replaced it — it's rejected too, because
reuse detection revoked everything.

**Password reset also revokes every session.** If someone's password is
reset, any refresh token issued before that point stops working
immediately — the assumption being that a password reset is often a
response to a suspected compromise.

## Password storage

Bcrypt, cost factor 12, via `@rideshare/auth` (`hashPassword` /
`verifyPassword`) — the same functions are used by `apps/api` at runtime
and by `packages/database`'s dev seed script, so passwords are always
hashed identically regardless of which code path created the account.
Passwords longer than 72 bytes are rejected outright rather than silently
truncated (bcrypt's own behavior, which is a subtle source of bugs if left
unhandled).

## Preventing user enumeration

Two endpoints are shaped specifically to avoid confirming whether an email
is registered:

- `POST /auth/login` returns the exact same `401 "Invalid email or
  password"` whether the email doesn't exist or the password is wrong,
  and runs a real bcrypt comparison against a dummy hash in the
  "no such user" case so the response doesn't come back measurably faster
  (a timing side-channel that would otherwise leak the same information).
- `POST /auth/password-reset/request` always returns `200` with the same
  response shape whether or not the account exists; a reset token is only
  actually created (and, outside production, returned) when it does.

## Password reset delivery (Stage 1 limitation)

Real email delivery is Phase 16's `NotificationProvider` abstraction,
which doesn't exist yet. Until then, `POST /auth/password-reset/request`
returns the raw reset token directly in the response body as
`devResetToken` — **but only when `NODE_ENV !== 'production'`**. This
keeps the flow fully testable now without a mail provider, and the
production code path already returns nothing, so wiring in real delivery
later is additive, not a behavior change to remove first.

## Authorization

Two middleware, always used together (`apps/api/src/middleware/auth.ts`):

- `requireAuth` — verifies the `Authorization: Bearer <token>` header,
  attaches `req.auth = { userId, role }` from the verified JWT payload.
  Missing header, malformed header, wrong signature, expired token, or a
  tampered token all produce the same `401 UNAUTHORIZED`.
- `requireRole(...roles)` — must run after `requireAuth`; rejects with
  `403 FORBIDDEN` unless `req.auth.role` is one of the given roles.

`req.auth.role` always comes from the server-signed JWT, never from a
request body, query param, or header a client controls — there is no code
path where a client can supply its own role and have it reach
`requireRole`. Hiding a button client-side is not authorization; every
role-gated endpoint checks on the server.

## Rate limiting

`express-rate-limit`, applied per-IP (`apps/api/src/middleware/rateLimit.ts`):

| Limiter | Window | Max requests |
| --- | --- | --- |
| Login | 15 minutes | 20 |
| Register (passenger or driver) | 1 hour | 10 |
| Password reset request/confirm | 1 hour | 10 |

Under `NODE_ENV=test` the ceiling is multiplied ×1000 rather than the
middleware being disabled — this keeps an automated test suite (many
requests from one IP in quick succession) from tripping the same limit a
real attacker would, while still exercising the middleware itself rather
than skipping it.

## Provisioning the first admin

There is no public admin registration endpoint (section 8). For local
development, `packages/database`'s seed script optionally creates two
admin accounts — one `ADMIN`, one `SUPER_ADMIN` — but **only if
`SEED_ADMIN_PASSWORD` is set** in `packages/database/.env`; if it's unset,
admin seeding is skipped entirely and nothing is logged but a notice. No
password is ever hardcoded in source.

```bash
SEED_ADMIN_PASSWORD='some-dev-only-password' npm run db:seed
# creates admin@example-dev.test and super.admin@example-dev.test
```

Production admin provisioning is out of scope for Stage 1
[LEGAL REVIEW REQUIRED] [PRODUCTION PAYMENT APPROVAL REQUIRED]-style
concerns aside — it needs a real deployment story this repo doesn't have
yet.

## Testing

- `apps/api/src/routes/auth.test.ts` — registration (passenger + driver),
  duplicate email/license conflicts, weak-password/missing-field
  validation, login success/failure, refresh rotation + reuse detection,
  logout, the full password-reset round trip (including that it revokes
  existing sessions), and `GET /auth/me`.
- `apps/api/src/authorization.test.ts` — the cross-role attack coverage
  Phase 2 explicitly asks for: a passenger hitting a driver-only endpoint
  (403), a driver hitting an admin-only endpoint (403), a passenger
  hitting an admin-only endpoint (403), an admin hitting a driver-only
  endpoint (403 — being an admin doesn't make you a driver), missing
  token (401), malformed header (401), wrong-secret forged token (401),
  expired token (401), tampered token (401), and a client-supplied `role`
  field in the request body being ignored entirely (403, because
  authorization only ever reads the role from the signed JWT).

Both suites run against a real PostgreSQL instance (`rideshare_test`),
not mocks, and are safe to run repeatedly without a database reset in
between — every test generates its own unique email/license via
`randomUUID()`.

Run them (after `db:migrate` against `rideshare_test`):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rideshare_test \
  npm run test --workspace=apps/api
```

## Environment variables (apps/api)

| Variable | Purpose |
| --- | --- |
| `JWT_ACCESS_SECRET` | Signs access tokens. Must be ≥32 characters; the API refuses to start otherwise. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `JWT_ACCESS_TOKEN_TTL` | Access token lifetime (`jsonwebtoken` `expiresIn` format, e.g. `15m`). |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | How long a refresh token / session stays valid. |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | How long a password reset token stays valid. |

See `apps/api/.env.example` for defaults.
