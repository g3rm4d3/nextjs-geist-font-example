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
