import type { NamedPoint } from '../context/RideDraftContext';

/**
 * Dev-only fixture destinations. There is no Google Places (or
 * equivalent) API key configured or verifiable in this environment
 * (docs/maps.md), so destination search works against this small curated
 * list instead of free-form address geocoding. Coordinates are real
 * places; the list itself is just for exercising the ride-draft flow
 * end-to-end without a paid, network-dependent geocoding key.
 */
export const SAMPLE_DESTINATIONS: NamedPoint[] = [
  {
    label: 'Central Library',
    coordinate: { latitude: 39.7684, longitude: -86.158 },
  },
  {
    label: 'City Market',
    coordinate: { latitude: 39.7691, longitude: -86.1567 },
  },
  {
    label: 'Convention Center',
    coordinate: { latitude: 39.7663, longitude: -86.1621 },
  },
  {
    label: 'Museum of Art',
    coordinate: { latitude: 39.8226, longitude: -86.1866 },
  },
  {
    label: 'International Airport',
    coordinate: { latitude: 39.7173, longitude: -86.2944 },
  },
  {
    label: 'University Campus',
    coordinate: { latitude: 39.7746, longitude: -86.1755 },
  },
  {
    label: 'Central Park',
    coordinate: { latitude: 39.7817, longitude: -86.1478 },
  },
  {
    label: 'Train Station',
    coordinate: { latitude: 39.7639, longitude: -86.1656 },
  },
];
