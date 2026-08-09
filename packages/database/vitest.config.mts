import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Constraint tests hit a real database sequentially (shared
    // TRUNCATE-between-tests state), so they must not run in parallel
    // against each other.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rideshare_test',
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
