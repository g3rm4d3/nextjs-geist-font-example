/** Pure formatting helpers — unit-testable without rendering anything. */

export function formatDistanceMiles(distanceMeters: number): string {
  const miles = distanceMeters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

export function formatDurationMinutes(durationSeconds: number): string {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  return minutes === 1 ? '1 min' : `${minutes} min`;
}
