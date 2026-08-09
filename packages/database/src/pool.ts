import { Pool } from 'pg';
import { env } from './env';

/**
 * Standalone connection pool for db:migrate / db:seed / db:reset. The API
 * process manages its own pool (apps/api/src/db/pool.ts) — this one exists
 * only for scripts that run outside that process.
 */
export function createScriptPool(): Pool {
  return new Pool({ connectionString: env.DATABASE_URL, max: 5 });
}
