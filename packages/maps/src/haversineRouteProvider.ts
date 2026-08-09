import type { Coordinate, RoutePreview, RouteProvider } from './types';

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Straight-line distance ("as the crow flies") tends to noticeably
 * undercount real road distance, especially in cities with a grid layout
 * or water/terrain obstacles. This is a rough, widely-used correction
 * factor for turning straight-line distance into a road-distance
 * estimate — not a substitute for a real routing engine.
 */
const ROAD_DISTANCE_CORRECTION_FACTOR = 1.3;

/** A reasonable average urban rideshare speed, used only to turn an estimated distance into an estimated duration. */
const DEFAULT_AVERAGE_SPEED_KMH = 30;

export interface HaversineRouteProviderOptions {
  averageSpeedKmh?: number;
}

/**
 * MOCK / dev-only RouteProvider — see BackgroundCheckProvider in Phase 1's
 * spec for the same pattern applied elsewhere. Computes straight-line
 * (great-circle) distance via the haversine formula and derives a rough
 * duration from an assumed average speed. This is NOT real road routing:
 * no traffic, no turn-by-turn path, no one-way streets. It exists so the
 * "create a valid route from pickup to destination" flow (Phase 3) is
 * fully testable without a paid, network-dependent routing API key this
 * environment has no way to provision or verify.
 *
 * Swap in a real provider (e.g. backed by Google Directions or another
 * routing service) later by implementing RouteProvider — nothing that
 * calls getRoute() needs to change.
 */
export function createHaversineRouteProvider(
  options: HaversineRouteProviderOptions = {},
): RouteProvider {
  const averageSpeedMetersPerSecond =
    ((options.averageSpeedKmh ?? DEFAULT_AVERAGE_SPEED_KMH) * 1000) / 3600;

  return {
    // Async to match RouteProvider's interface, which real network-backed
    // implementations need — even though this one never actually awaits.
    async getRoute(origin: Coordinate, destination: Coordinate): Promise<RoutePreview> {
      const straightLineDistanceMeters = haversineDistanceMeters(origin, destination);
      const distanceMeters = Math.round(
        straightLineDistanceMeters * ROAD_DISTANCE_CORRECTION_FACTOR,
      );
      const durationSeconds = Math.round(distanceMeters / averageSpeedMetersPerSecond);

      return { distanceMeters, durationSeconds };
    },
  };
}

function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
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
