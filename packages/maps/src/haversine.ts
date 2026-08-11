import type { Coordinate } from './types';

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle ("as the crow flies") distance between two points, via
 * the standard haversine formula. Exported publicly (not just used
 * internally by `createHaversineRouteProvider`) because Phase 10 needs
 * the same formula for a second purpose: summing consecutive recorded
 * GPS points (`ride_location_samples`) into an actual trip distance —
 * see `apps/api`'s rideLifecycleService.completeRide. One formula, two
 * callers, rather than a second copy drifting out of sync.
 */
export function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);

  const sinDeltaLat = Math.sin(deltaLat / 2);
  const sinDeltaLng = Math.sin(deltaLng / 2);

  const h = sinDeltaLat * sinDeltaLat + Math.cos(lat1) * Math.cos(lat2) * sinDeltaLng * sinDeltaLng;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_METERS * centralAngle;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
