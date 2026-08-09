import { createDbClient, type Database } from '@rideshare/database';
import { pool } from './pool';

/**
 * Schema-typed Drizzle client wrapping the same pool `checkDatabaseConnection`
 * uses. One pool, one client — repositories import this rather than
 * opening their own connection.
 */
export const db: Database = createDbClient(pool);
