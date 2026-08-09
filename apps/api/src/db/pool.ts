import { Pool } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Single shared connection pool for the process. Domain-specific data
 * access (repositories) added in later phases should import this pool
 * rather than opening their own connections.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
});

pool.on('error', (error) => {
  // Fired for errors on idle clients (e.g. connection dropped by the
  // server) — must be handled or an unhandled 'error' event crashes the
  // process.
  logger.error({ err: error }, 'Unexpected error on idle PostgreSQL client');
});

export interface DatabaseHealth {
  connected: boolean;
  latencyMs: number | null;
}

/**
 * Cheap connectivity probe used by GET /health. Never throws: a database
 * outage should be reported, not crash the health endpoint.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealth> {
  const startedAt = Date.now();

  try {
    await pool.query('SELECT 1');
    return { connected: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return { connected: false, latencyMs: null };
  }
}
