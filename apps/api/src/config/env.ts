import 'dotenv/config';
import { z } from 'zod';

/**
 * All process.env access in this application must go through this module.
 * Reading `process.env` directly elsewhere risks silently running with an
 * undefined/misspelled variable instead of failing fast at startup.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),

  // Signs short-lived access tokens (JWT, HS256). Refresh tokens are
  // opaque random values, not JWTs, so they need no secret of their own —
  // see src/lib/tokens.ts.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters — generate a real random secret'),
  JWT_ACCESS_TOKEN_TTL: z.string().default('15m'),
  JWT_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  // Phase 8 — Matching Engine. The "response timer" a driver has to
  // ACCEPT/DECLINE an offer before it's swept up as TIMEOUT, and how
  // often the background sweep (src/index.ts) checks for expired offers.
  // Short defaults are deliberate: this environment has no real drivers
  // idling on a timer, so tests and manual verification should not need
  // to wait long to see a timeout happen.
  MATCHING_OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),
  MATCHING_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  // Phase 10 — Realtime Ride Experience. "Use configurable GPS sampling"
  // / "do not persist unnecessary high-frequency data": a driver's
  // current position (driver_locations) is still upserted on every ping
  // (throttled by locationService's own fixed 2s interval, unchanged
  // since Phase 6) — this is a *second*, coarser throttle governing only
  // how often a historical breadcrumb (ride_location_samples) is written
  // for the ride currently IN_PROGRESS. Deliberately independent and
  // separately configurable: "show me where the driver is right now"
  // and "keep a route history to compute actual distance from" are
  // different needs with different acceptable staleness.
  RIDE_LOCATION_SAMPLE_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),

  // Phase 11 — Payment Sandbox. Both optional: unset means "use the MOCK
  // PaymentProvider" (see lib/paymentProvider.ts), which is the default
  // in every environment here since there is no real (even TEST MODE)
  // Stripe secret key this environment can provision or verify (see
  // docs/payments.md). When STRIPE_SECRET_KEY is set it must be a TEST
  // MODE key — createStripePaymentProvider enforces that itself.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Intentionally uses console here: the structured logger depends on env
    // (LOG_LEVEL) and may not be safely constructible yet at this point.
    console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
