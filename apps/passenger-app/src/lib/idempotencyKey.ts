/**
 * Section 7: a client-generated key, one per ride-request *attempt* —
 * generated once (e.g. via `useState(() => generateIdempotencyKey())` so
 * it's stable across re-renders of the same screen instance) and resent
 * unchanged on every retry of that same attempt, including a double-tap
 * that fires before the request button disables. The server dedupes on
 * (passenger, key), so reusing the same key is what makes a retry safe
 * instead of creating a second ride.
 *
 * Not a cryptographic UUID — React Native's JS engine doesn't reliably
 * provide `crypto.randomUUID()` without a polyfill this app doesn't
 * otherwise need, and the server's uniqueness check is scoped to one
 * passenger, so a `Math.random()`-based suffix already has a
 * astronomically low collision chance for what this needs: distinct
 * "attempt" identifiers, not secrets.
 */
export function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
