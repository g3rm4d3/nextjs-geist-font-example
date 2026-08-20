import type { ErrorTracker, ErrorTrackingContext } from './errorTracker';

/**
 * Structural subset of pino's `Logger` — deliberately not an import of
 * `pino` itself (this package stays dependency-free, same as
 * `@rideshare/screening`) or even of `@rideshare/logging`'s `Logger`
 * type, so any object shaped like `{ error(obj, msg) }` works. Callers
 * pass their real pino logger directly; TypeScript's structural typing
 * accepts it without an adapter.
 */
export interface ErrorTrackerLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Every event this tracker emits is tagged with this, so a log
 * aggregator (or `grep`) can select "every tracked error" as its own
 * stream, distinct from the routine `logger.error(...)` calls this
 * codebase already makes for expected failure paths (a declined
 * payment, a 404, a validation error) that were never meant to page
 * anyone. */
const EVENT = 'error_tracked';

/**
 * The only `ErrorTracker` implementation Stage 1 ships. This is not a
 * placeholder standing in for "the real one" the way, say,
 * `packages/screening`'s MOCK stands in for a real background-check API
 * — there genuinely is no external error-tracking service configured or
 * reachable in this environment (no Sentry/Rollbar/Bugsnag DSN, no
 * network egress to one), and Stage 1 is explicitly technical
 * validation only (see the repo root's own scope statement), not a
 * commercial deployment that would need one. Routing every captured
 * exception through the same structured logger (`packages/logging`,
 * with its own redaction list — see docs/troubleshooting.md) rather
 * than a separate, unredacted channel is itself part of that "never log
 * secrets" requirement holding for error tracking too, not just normal
 * request logs.
 *
 * A real provider is a drop-in `ErrorTracker` implementation behind this
 * same interface whenever one is actually wired up — every call site in
 * `apps/api` already goes through `ErrorTracker.captureException`, not
 * a concrete class, so swapping the implementation touches one
 * composition point (wherever the tracker is constructed), not every
 * call site.
 */
export function createLoggingErrorTracker(logger: ErrorTrackerLogger): ErrorTracker {
  return {
    captureException(error: unknown, context?: ErrorTrackingContext): void {
      try {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ err, ...context, event: EVENT }, err.message);
      } catch {
        // See the interface's own doc comment: a broken tracker must
        // never be allowed to throw back into whatever was already
        // failing. Nothing further to do if even this fails.
      }
    },
  };
}
