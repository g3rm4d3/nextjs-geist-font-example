import type { NamedPoint } from '../context/RideDraftContext';

/** Pure so it's unit-testable without rendering a screen. */
export function filterDestinations(destinations: NamedPoint[], query: string): NamedPoint[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return destinations;
  return destinations.filter((destination) => destination.label.toLowerCase().includes(normalized));
}
