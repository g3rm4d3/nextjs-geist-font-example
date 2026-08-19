import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

interface LimiterOptions {
  windowMs: number;
  max: number;
  message: string;
  /** Defaults to express-rate-limit's own IP-based key. Pass this for
   * limiters that sit behind requireAuth and should count per signed-in
   * identity instead — see locationPingLimiter below for why that
   * distinction matters. */
  keyGenerator?: (req: Request) => string;
}

function createLimiter({ windowMs, max, message, keyGenerator }: LimiterOptions) {
  return rateLimit({
    windowMs,
    // Per-IP counters make an automated test suite (many requests from
    // 127.0.0.1 in quick succession) trip the same limit a real attacker
    // would. Rather than disabling the middleware under test — which
    // would leave it unexercised — raise the ceiling enough that normal
    // test runs never hit it, while a wiring bug still would.
    max: env.NODE_ENV === 'test' ? max * 1000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Route through the app's normal error envelope (with requestId)
    // instead of express-rate-limit's own default plaintext response.
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', message));
    },
  });
}

export const loginLimiter = createLimiter({
  windowMs: 15 * MINUTE_MS,
  max: 20,
  message: 'Too many login attempts. Try again later.',
});

export const registerLimiter = createLimiter({
  windowMs: HOUR_MS,
  max: 10,
  message: 'Too many registration attempts. Try again later.',
});

export const passwordResetLimiter = createLimiter({
  windowMs: HOUR_MS,
  max: 10,
  message: 'Too many password reset requests. Try again later.',
});

export const routePreviewLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many route preview requests. Try again in a moment.',
});

export const pricingEstimateLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many fare estimate requests. Try again in a moment.',
});

// ~1/sec sustained per *driver* — generous for a single driver's normal
// ping cadence (expo-location's watchPositionAsync is configured for one
// update per ~5s in apps/driver-app) while still bounding a misbehaving
// client. locationService's own min-write-interval throttle is the
// primary "avoid excessive database writes" mechanism; this is the
// outer backstop against outright abuse.
//
// Keyed by driver identity (req.auth.userId), not IP: this endpoint
// always sits behind requireAuth, and IP is the wrong dimension for it —
// many drivers' phones can legitimately share one IP (carrier-grade NAT
// on cellular networks), and conversely this is a per-driver operational
// cadence limit, not an anti-account-abuse one like login/register's
// IP-based limiters. An IP-keyed limiter here would throttle unrelated
// drivers sharing a gateway, and was caught immediately by this phase's
// own 50-virtual-driver simulator hammering one IP (localhost) in
// development — a real finding this fix addresses, not a hypothetical.
// Exported on its own (not just inlined) so it's unit-testable without
// spinning up the whole rate-limit machinery — see rateLimit.test.ts.
export function locationPingKeyGenerator(req: Request): string {
  // ipKeyGenerator (not a bare req.ip) normalizes IPv6 addresses to a
  // subnet — express-rate-limit refuses to start otherwise, since a raw
  // IPv6 address lets a client cycle through addresses in its own /64 to
  // dodge the limit. Only reached if req.auth is somehow missing, which
  // shouldn't happen behind requireAuth.
  return req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

export const locationPingLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 60,
  message: 'Too many location updates. Try again in a moment.',
  keyGenerator: locationPingKeyGenerator,
});

// Section 7: idempotency + the one-active-ride constraint are what
// actually prevent duplicate rides; this is just an outer backstop
// against a client hammering the endpoint. Keyed per passenger for the
// same reason as locationPingLimiter above — this always sits behind
// requireAuth, and IP is the wrong dimension for a per-passenger action.
export const rideRequestLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 20,
  message: 'Too many ride requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 8: covers GET .../offer (polling) and the accept/decline actions.
// Generous enough for a driver-app poll loop (a few seconds apart) plus
// an occasional accept/decline, but still per-driver — same reasoning as
// locationPingLimiter above, not IP-based.
export const driverOfferLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 60,
  message: 'Too many offer requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 9: the ride lifecycle transition + cancel + GET-ride endpoints,
// for both apps. Same per-user (not per-IP) reasoning as every other
// limiter in this file below — these sit behind requireAuth, and a
// driver's own progression through one ride is a per-user cadence, not
// an IP dimension.
export const rideLifecycleLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 60,
  message: 'Too many requests for this ride. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 11: passenger-facing payment reads/retries + the passenger's own
// default test payment method update. Same per-user (not per-IP)
// reasoning as every limiter above that sits behind requireAuth.
export const paymentLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many payment requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 11: POST /webhooks/stripe has no authenticated caller — Stripe
// itself calls it — so unlike every limiter above this is IP-keyed
// (express-rate-limit's default), like login/register. Signature
// verification (paymentService.handleStripeWebhookEvent) is what
// actually rejects forged deliveries; this is just an outer backstop
// against a flood of requests, generous enough for real webhook bursts.
export const stripeWebhookLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 120,
  message: 'Too many webhook deliveries. Try again in a moment.',
});

// Phase 12: driver earnings summary/history + the admin revenue read.
// Same per-user (not per-IP) reasoning as every limiter above that sits
// behind requireAuth — admins share office/VPN egress IPs just as
// plausibly as drivers share cellular NAT (locationPingLimiter's own
// reasoning), so per-identity is the right dimension here too.
export const earningsLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many earnings requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 13: rating submission/reads, both directions. Same per-user
// reasoning as every limiter above — a passenger or driver only ever
// submits a handful of ratings per ride, so this is a generous outer
// backstop, not the mechanism enforcing "one rating per direction per
// ride" (ratingsService + the DB's own unique index do that).
export const ratingLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many rating requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 15: a driver's own document upload/list. Uploads are inherently
// infrequent (a handful of documents, occasionally replaced) — this is
// mostly a backstop against a buggy client retry-looping the upload
// call, not a cadence limiter like locationPingLimiter. Per-user, same
// reasoning as every limiter above that sits behind requireAuth.
export const documentLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 20,
  message: 'Too many document requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 14: every admin-app read/write across every section (dashboard,
// passengers, drivers, documents, rides, payments, ratings, support,
// pricing, settings, audit logs). One shared limiter, not one per
// section — an admin operator legitimately clicks through many of these
// in quick succession while working a queue, and the sections don't
// need independently-tuned ceilings. Per-user, same reasoning as every
// limiter above.
export const adminLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 120,
  message: 'Too many admin requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 16: a passenger/driver's own notification list/read/push-token
// endpoints. Generous enough for a client that polls its notification
// list periodically (there is no realtime push delivery mechanism to
// the client beyond the notification itself — see docs/notifications.md)
// plus the occasional mark-read/register-token call. Per-user, same
// reasoning as every limiter above that sits behind requireAuth.
export const notificationLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 60,
  message: 'Too many notification requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

// Phase 18: a passenger/driver's own support-ticket create/list/read
// endpoints. Opening a ticket is inherently infrequent — this is mostly
// a backstop against a buggy client retry-looping the create call, same
// reasoning as documentLimiter. Per-user, same convention as every
// limiter above that sits behind requireAuth.
export const supportLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 20,
  message: 'Too many support requests. Try again in a moment.',
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});
