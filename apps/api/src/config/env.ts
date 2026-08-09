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
