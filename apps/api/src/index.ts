import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { sweepExpiringDocuments } from './services/documentService';
import { sweepExpiredOffers } from './services/matchingService';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

/**
 * Phase 8's "response timer" sweep: periodically expires OFFERED offers
 * whose timer has elapsed and advances those rides to the next
 * candidate. Deliberately lives here (actual process startup), not
 * inside createApp() — createApp() is also what rides.test.ts and every
 * other supertest suite builds directly, and a background interval
 * ticking during those runs would make them non-deterministic (see
 * docs/matching-engine.md and the same reasoning already applied to
 * every other timer in this codebase).
 */
const matchingSweepInterval = setInterval(() => {
  sweepExpiredOffers().catch((error: unknown) => {
    logger.error({ err: error }, 'Matching sweep failed');
  });
}, env.MATCHING_SWEEP_INTERVAL_MS);

/**
 * Phase 16's "internal expiration warnings" sweep: periodically notifies
 * drivers of APPROVED documents newly within their expiration warning
 * window. Same "lives here, not in createApp()" reasoning as
 * matchingSweepInterval above — a supertest suite building createApp()
 * directly must never have a background interval ticking during it.
 */
const documentExpirationSweepInterval = setInterval(() => {
  sweepExpiringDocuments().catch((error: unknown) => {
    logger.error({ err: error }, 'Document expiration sweep failed');
  });
}, env.DOCUMENT_EXPIRATION_SWEEP_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully`);
  clearInterval(matchingSweepInterval);
  clearInterval(documentExpirationSweepInterval);
  server.close(() => {
    logger.info('HTTP server closed');
  });
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
