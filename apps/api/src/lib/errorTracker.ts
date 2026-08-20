import { createLoggingErrorTracker, type ErrorTracker } from '@rideshare/observability';
import { logger } from './logger';

/**
 * Single shared ErrorTracker instance for the process — same pattern as
 * notificationProvider.ts/paymentProvider.ts. Stage 1 has exactly one
 * implementation (see @rideshare/observability's own doc comment for
 * why); this is the one composition point that would change if a real
 * provider (Sentry, etc.) were ever wired in — no call site elsewhere in
 * apps/api needs to change.
 */
export const errorTracker: ErrorTracker = createLoggingErrorTracker(logger);
