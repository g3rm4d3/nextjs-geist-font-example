import { env } from './env';
import { maskConnectionString, runMigrations } from './migrate';
import { createScriptPool } from './pool';

/**
 * Drops and recreates the `public` schema, then re-runs every migration
 * from zero. Does NOT seed — run `npm run seed` afterwards if you want
 * fictional dev data. This is destructive by design (that's the point of
 * "reset"), so it refuses to run against what looks like a production
 * database unless explicitly forced.
 */
async function main() {
  if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error(
      'Refusing to reset a database with NODE_ENV=production. Pass --force if you are ' +
        'certain (this destroys all data).',
    );
    process.exitCode = 1;
    return;
  }

  const pool = createScriptPool();

  console.log(`Dropping and recreating schema on ${maskConnectionString(env.DATABASE_URL)} ...`);
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  // drizzle-kit tracks which migrations have run in a separate `drizzle`
  // schema (drizzle.__drizzle_migrations) — it does not live under
  // `public`, so it must be dropped too or the migrator below will think
  // every migration already ran and silently leave `public` empty.
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.end();

  await runMigrations();

  console.log('Database reset complete. Run `npm run db:seed` for fictional dev data.');
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error);
  process.exitCode = 1;
});
