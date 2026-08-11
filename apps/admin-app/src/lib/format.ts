/** Pure formatting helper — unit-testable without rendering anything.
 * Deliberately duplicated from apps/passenger-app and apps/driver-app's
 * own lib/format.ts rather than shared: three independent app packages,
 * nothing here depends on domain logic that would need to stay in sync
 * (see docs/architecture.md on what does and doesn't get shared). */

/** cents is always an integer (section 10) — this only formats for display, never computes. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
