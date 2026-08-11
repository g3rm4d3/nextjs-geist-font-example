# Payment Sandbox — Phase 11

## Scope

Section 11: a `PaymentProvider` abstraction with a MOCK implementation
and a real Stripe TEST MODE implementation, exercising the full
lifecycle — PaymentIntent creation, confirmation with a test payment
method, webhook handling with signature verification, idempotency,
successful/failed payments, and refund architecture — while enforcing
"NO LIVE TRANSACTIONS" in code, not just policy. **This is a sandbox.**
No real card is ever collected, no real money ever moves, and the
Stripe secret key guard makes a live key impossible to use even by
accident.

## `@rideshare/payments`

A new package, same shape as `@rideshare/maps` (Phase 3): a provider
interface plus a MOCK implementation and a real, network-backed
implementation behind the same contract.

```ts
interface PaymentProvider {
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  confirmPaymentIntent(providerPaymentIntentId: string, testPaymentMethodId: string): Promise<PaymentConfirmationResult>;
  refundPaymentIntent(providerPaymentIntentId: string, reason?: string): Promise<RefundResult>;
  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string, webhookSecret: string): PaymentWebhookEvent;
}
```

`createMockPaymentProvider()` is deterministic and fully in-memory — no
network call, ever. `createStripePaymentProvider({ secretKey })` is
backed by the real `stripe` npm SDK (v22.5.0) and talks to
`api.stripe.com` for `createPaymentIntent`/`confirmPaymentIntent`/
`refundPaymentIntent`. `apps/api/src/lib/paymentProvider.ts` picks
between them exactly the way `mapProvider.ts` picks a `RouteProvider`:
MOCK by default, real provider only if `STRIPE_SECRET_KEY` is set. This
environment has no real (even TEST MODE) Stripe secret key it can
provision or verify — the same documented limitation as `docs/maps.md`'s
routing provider — so every test and manual verification below runs
against the MOCK provider.

### Test payment methods, not real cards

Section 11 requires a "test payment method," not a real one. Stage 1
never collects card details anywhere — instead, a passenger picks one of
Stripe's own publicly-documented TEST MODE payment method ids
(`TEST_PAYMENT_METHODS` in `testPaymentMethods.ts`):

| id | Outcome |
|---|---|
| `pm_card_visa` | Succeeds (the default) |
| `pm_card_chargeDeclined` | Declines (generic) |
| `pm_card_chargeDeclinedInsufficientFunds` | Declines (insufficient funds) |
| `pm_card_chargeDeclinedExpiredCard` | Declines (expired card) |
| `pm_card_chargeDeclinedProcessingError` | Declines (processing error) |

These ids are safe, non-sensitive constants Stripe itself publishes for
testing — not card numbers, not secrets. The MOCK provider gives each id
the exact same outcome the real Stripe TEST MODE API would, so nothing
about a caller's expectations changes when the real provider is swapped
in later.

### Webhook signature verification is genuinely exercised

`stripe.webhooks.constructEvent(payload, header, secret)` is pure local
HMAC-SHA256 verification — it never makes a network call and never
validates the API key it was constructed with. That means
`webhookVerification.ts`'s `verifyStripeWebhookSignature` can be shared,
unmodified, by *both* the MOCK and real Stripe providers: the MOCK
provider's webhook handling is not a faked check standing in for the
real thing, it's the same Stripe SDK code path. Tests use
`Stripe.webhooks.generateTestHeaderString({ payload, secret })` to
produce validly-signed test deliveries deterministically, with no
network dependency — see `packages/payments/src/mockPaymentProvider.test.ts`
and `apps/api/src/routes/payments.test.ts`.

### "NO LIVE TRANSACTIONS" enforced in code

`createStripePaymentProvider` throws immediately if `secretKey` doesn't
start with `sk_test_`. A live secret key literally cannot produce a
usable provider instance — this is a hard constructor guard
(`stripePaymentProvider.test.ts`), not a comment or a runbook step.

## Database changes

Two migrations' worth of schema already existed from Phase 1
(`payment_records` with `status`/`amount_cents`/`provider`/
`provider_payment_intent_id`/`idempotency_key`/`failure_reason`, and the
`payment_status` enum: `PENDING | SUCCEEDED | FAILED | REFUNDED`). This
phase's migration (`0003_dusty_roland_deschain.sql`) adds:

- `payment_records.refunded_at` (timestamptz, nullable) — doubles as the
  "was this refunded" flag.
- `payment_records.refund_reason` (text, nullable).
- `passenger_profiles.default_test_payment_method_id` (text, nullable) —
  which test payment method to charge by default; null falls back to
  `DEFAULT_TEST_PAYMENT_METHOD_ID` (`pm_card_visa`).

Multiple `payment_records` rows are allowed per ride (a retry after a
`FAILED` attempt is a new row, new `idempotency_key`) — that was already
true of the schema's design (see its own comment), this phase is the
first to actually produce a second row for the same ride.

## Backend

### Auto-charge on ride completion

There is no client-initiated "pay" action. `rideLifecycleService.completeRide`
— immediately after the ride reaches `COMPLETED` and its `final_fare_cents`
is authoritative — calls `paymentService.chargeRideFare(rideId)`, wrapped
in try/catch: a payment-provider hiccup must not fail ride completion
itself, the same "best-effort side effect" precedent Phase 7/8 set for
`startMatching`. The amount charged is always `ride.finalFareCents`,
computed server-side by `pricingService` — there is no field anywhere a
client could use to influence it.

`chargeRideFare`:

1. Looks up the passenger's `defaultTestPaymentMethodId` (or falls back
   to `pm_card_visa`).
2. Creates a `payment_records` row (`PENDING`), with idempotency key
   `ride-payment-{rideId}`.
3. Calls `paymentProvider.createPaymentIntent`, stores the resulting
   `providerPaymentIntentId`.
4. Calls `paymentProvider.confirmPaymentIntent` with the test payment
   method — Stripe TEST MODE confirmation resolves synchronously, so
   this updates the record directly with `SUCCEEDED`/`FAILED` via an
   atomic conditional `UPDATE ... WHERE status = 'PENDING'` (the same
   compare-and-swap pattern `advanceRideStatus` uses for ride status).

### Webhook handling doubles as the authoritative async path

`POST /webhooks/stripe` performs the *exact same* compare-and-swap,
keyed by `provider_payment_intent_id` instead of the internal id (a
webhook delivery only ever carries the provider's reference). Because
the synchronous confirm above already resolves the common case, a
webhook redelivering the same outcome is a no-op — the compare-and-swap
only ever transitions a record that's still `PENDING`. This mirrors how
a real (fully async) Stripe integration would work, where the webhook —
not the confirm call's immediate response — is the authoritative
completion signal.

The route is mounted in `app.ts` **before** the global
`express.json()` body parser, using `express.raw({ type: 'application/json' })`
scoped to just that route: Stripe signs the exact raw request body
bytes, and a parsed-then-re-serialized JSON body would not byte-for-byte
match what was signed. An invalid or missing `stripe-signature` header
is rejected (`403`) before any database lookup happens.

### Idempotency

Two layers, matching Phase 7's ride-request precedent:

- `payment_records.idempotency_key` is unique — `chargeRideFare` always
  uses `ride-payment-{rideId}` for the first attempt, so `completeRide`
  firing this twice for the same ride (guarded against explicitly, but
  belt-and-suspenders) can't double-charge.
- A retry (`POST /rides/:id/payment/retry`) generates a fresh key
  (`ride-payment-{rideId}-retry-{uuid}`) — deliberately a *new* attempt,
  not a replay of the failed one, since payment_records is designed to
  hold one row per attempt.

### Routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/rides/:id/payment` | Passenger-only; the ride's latest payment attempt. `404` if the ride isn't the caller's or nothing has been charged yet. |
| `POST` | `/rides/:id/payment/retry` | Passenger-only; `409` unless the latest attempt is `FAILED`. |
| `PATCH` | `/passengers/me/payment-method` | Sets `default_test_payment_method_id`; `400` for any id outside `TEST_PAYMENT_METHODS`. |
| `GET` | `/payments/test-methods` | The catalog, so the client doesn't hardcode a duplicate copy. |
| `POST` | `/webhooks/stripe` | No `requireAuth` — the caller is Stripe. Signature verification is the authentication. |

### Refund architecture

`paymentService.refundPayment(paymentRecordId, reason?)` is implemented
and directly tested end to end: it only accepts a `SUCCEEDED` payment,
calls `paymentProvider.refundPaymentIntent`, and performs a compare-and-
swap to `REFUNDED` (`refunded_at`/`refund_reason` set). **Not yet wired
to a route** — full refunds only, no partial-refund support, and no
admin- or passenger-facing endpoint calls it yet. Phase 12's admin
payment/revenue visibility is the natural place to surface it; this
phase's job was proving the capability is real, not exposing it.

## Passenger app

- **`PaymentMethodsScreen`**: fetches `GET /payments/test-methods`,
  renders each as a card (label, description, a "Succeeds"/"Declines"
  badge), and `PATCH`es the passenger's default on tap.
- **`RideCompleteScreen`**: shows the ride's `final_fare_cents`
  alongside its payment status (`GET /rides/:id/payment`), with a
  "Retry payment" button that appears only when the status is `FAILED`.
  A `404` here (the auto-charge attempt hasn't landed yet, or — rarely —
  never will) is treated as "nothing to show," not an error. The rating
  prompt this screen's Phase 9 stub also mentioned is still Phase 13's job.

Neither screen ever renders anything card-shaped: `apiClient.ts`'s
`getRidePayment`/`getTestPaymentMethods`/`updateDefaultPaymentMethod`
carry only `Payment`/`TestPaymentMethodSummary` (opaque ids, statuses,
amounts) — the same provider-safe types the backend persists.

## Tests

`apps/api/src/routes/payments.test.ts` (12 tests), all against a real
PostgreSQL database and the MOCK provider, driving full passenger/driver
registration → matching → lifecycle → `COMPLETED` flows via HTTP:

- Auto-charge succeeds with the default test payment method; the
  response contains no card-shaped data.
- A passenger who selected a declining test payment method gets a
  `FAILED` payment with a failure reason; switching to `pm_card_visa`
  and retrying produces a second, `SUCCEEDED` row (two distinct
  `payment_records`, two distinct idempotency keys).
- Retry is rejected (`409`) once the latest attempt already succeeded.
- Cross-passenger isolation: `404` reading or retrying another
  passenger's ride payment.
- An unrecognized test payment method id is rejected (`400`).
- Webhook: invalid signature → `403`; a validly-signed event for an
  unknown intent → `200` no-op; a genuinely `PENDING` record (inserted
  directly via the repository, bypassing the synchronous confirm path)
  resolves to `SUCCEEDED`/`FAILED` via a real signature-verified
  delivery; redelivering an event for an already-`SUCCEEDED` record is a
  no-op (idempotency).
- `refundPayment` refunds a `SUCCEEDED` payment and rejects refunding
  anything else.

`packages/payments` (21 tests): the test payment method catalog, the
MOCK provider's full create → confirm (success/decline/unknown) →
refund flow, and webhook signature verification (accept valid, reject
wrong-secret, reject tampered payload, reject unsupported event type) —
plus the same signature tests again against the real
`createStripePaymentProvider`, and its `sk_test_` constructor guard.

Full repo verification after this phase: lint, typecheck, and a clean
`rm -rf packages/*/dist && npm run build` all pass; a from-zero
`db:migrate` + `db:seed` is clean; 138 tests passing in `apps/api` (up
from 126 before this phase), 21 in the new `packages/payments`, every
other workspace's suite unaffected.

## Known limitations

- **No real Stripe credentials in this environment.** Every test and
  manual verification above runs against the MOCK provider. The real
  `createStripePaymentProvider`'s `createPaymentIntent`/
  `confirmPaymentIntent`/`refundPaymentIntent` calls are implemented and
  typechecked but cannot be exercised end-to-end here — only webhook
  signature verification (pure local HMAC, no network/API key needed)
  is genuinely tested against the real Stripe SDK.
- **Full refunds only.** No partial-refund support — `refundPaymentIntent`
  always refunds the full `payment_records.amount_cents`.
- **Refund has no route yet.** `paymentService.refundPayment` is real and
  tested but not reachable from any endpoint — Phase 12's job.
- **No payout/earnings integration in this phase.** `driver_earnings`
  (seeded since Phase 1, untouched here) is a separate ledger; this
  phase only charges the passenger, it doesn't move money to a driver's
  payout record. That linkage, if any, is Phase 12's.
- **One payment method per passenger, not per ride.** A passenger has a
  single `default_test_payment_method_id`; there's no "choose a payment
  method for this specific ride" flow — every ride they complete charges
  whatever their current default is at the moment of completion.
- **Webhook route has no admin-configurable secret rotation.** `STRIPE_WEBHOOK_SECRET`
  is one fixed env var; a real deployment supporting multiple webhook
  endpoints/secrets would need more than this.
