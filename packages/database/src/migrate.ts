import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from './env';
import { createScriptPool } from './pool';

/** Never print a connection string with its password in it. */
export function maskConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

/**
 * Applies every migration under /migrations that hasn't run yet, tracked
 * via Drizzle's own `drizzle.__drizzle_migrations` table. Idempotent —
 * safe to call against a database that's already up to date.
 */
export async function runMigrations(): Promise<void> {
  const pool = createScriptPool();
  const db = drizzle(pool);

  console.log(`Applying migrations to ${maskConnectionString(env.DATABASE_URL)} ...`);
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'migrations') });
  console.log('Migrations applied successfully.');

  await pool.end();
}

// Only run automatically when this file is executed directly (`npm run
// migrate`), not when imported by reset.ts.
if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
}
