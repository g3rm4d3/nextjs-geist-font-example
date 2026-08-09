export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface RoutePreview {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Section 13's MapProvider abstraction, scoped for Stage 1 to the one
 * thing the passenger app currently needs: a route preview (distance +
 * duration) between two points. Consumed server-side only (apps/api) —
 * mobile clients call the API, never a map provider directly, so no API
 * key is ever embedded in a client bundle. Swapping in a real routing
 * backend later means implementing this interface, not rewriting
 * anything that calls it.
 */
export interface RouteProvider {
  getRoute(origin: Coordinate, destination: Coordinate): Promise<RoutePreview>;
}
