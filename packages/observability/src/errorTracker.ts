/**
 * Phase 22's "error tracking abstraction" — deliberately the same shape
 * as this codebase's other provider abstractions (PaymentProvider,
 * NotificationProvider, StorageProvider, ScreeningProvider,
 * RouteProvider): one small interface, one MOCK-ish default
 * implementation usable everywhere today, and a seam a real provider
 * (Sentry, Rollbar, Bugsnag, ...) could implement later without any
 * caller needing to change. Unlike those other abstractions, Stage 1
 * has no real implementation at all — see `loggingErrorTracker.ts`'s own
 * doc comment for why that's the deliberate, honest choice here rather
 * than a corner cut.
 */

/**
 * Free-form structured context attached to a tracked error — the same
 * correlation fields this codebase's logs already carry (see
 * docs/troubleshooting.md): `requestId` ties an error back to the exact
 * HTTP request that triggered it; `rideId` ties it to a specific ride's
 * story even when there's no request in scope (a background sweep, an
 * async webhook handler). Extra fields are allowed for anything
 * caller-specific, but must never include the values `docs/security.md`
 * and `packages/logging`'s own redaction list forbid — passwords, auth
 * tokens, full card numbers, document contents, secrets. This interface
 * doesn't enforce that (it can't, generically); every call site is
 * responsible for only passing safe context, same as every other
 * logger.error(...) call in this codebase already is.
 */
export interface ErrorTrackingContext {
  requestId?: string;
  rideId?: string;
  userId?: string;
  route?: string;
  [key: string]: unknown;
}

export interface ErrorTracker {
  /**
   * Records that an error happened, along with whatever context is
   * available. Implementations must never throw — a broken error
   * tracker must not be able to take down the request that was already
   * failing for an unrelated reason.
   */
  captureException(error: unknown, context?: ErrorTrackingContext): void;
}
