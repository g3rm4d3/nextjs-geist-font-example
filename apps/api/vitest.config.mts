import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      PORT: '4001',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rideshare_test',
      LOG_LEVEL: 'error',
      // Fixed (not random) so token assertions are reproducible across
      // runs; this is a test-only secret, never used outside this file.
      JWT_ACCESS_SECRET: 'test-only-access-token-secret-do-not-use-elsewhere-32chars+',
      JWT_ACCESS_TOKEN_TTL: '15m',
      JWT_REFRESH_TOKEN_TTL_DAYS: '30',
      PASSWORD_RESET_TOKEN_TTL_MINUTES: '30',
      // Phase 11: deliberately no STRIPE_SECRET_KEY here — the MOCK
      // PaymentProvider (apps/api/src/lib/paymentProvider.ts) is what
      // every test below exercises, matching Stage 1's default (no real
      // Stripe credentials configured or verifiable in this
      // environment, see docs/payments.md). The webhook secret is a
      // fixed test-only value so signature tests are reproducible.
      STRIPE_WEBHOOK_SECRET: 'whsec_test_only_secret_do_not_use_elsewhere',
    },
    // Auth/authorization tests share state (users, sessions) in the same
    // database across files; keep them from racing each other.
    fileParallelism: false,
  },
});
