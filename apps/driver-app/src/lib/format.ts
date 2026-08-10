/** Pure formatting helpers — unit-testable without rendering anything.
 * Deliberately duplicated from apps/passenger-app's own lib/format.ts
 * rather than shared: these are two independent app packages, and
 * nothing here depends on domain logic that would need to stay in sync
 * (see docs/architecture.md on what does and doesn't get shared). */

export function formatDistanceMiles(distanceMeters: number): string {
  const miles = distanceMeters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

export function formatDurationMinutes(durationSeconds: number): string {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

/** cents is always an integer (section 10) — this only formats for display, never computes. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
