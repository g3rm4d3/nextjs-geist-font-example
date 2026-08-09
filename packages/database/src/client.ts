import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Wraps an existing pg Pool in a schema-typed Drizzle client. Callers own
 * the Pool's lifecycle (creation and `.end()`); this function does not
 * open a connection itself, so it's safe to call once per process and
 * reuse the returned client everywhere (repositories in later phases,
 * scripts here).
 */
export function createDbClient(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export * as schema from './schema';
