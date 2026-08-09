import { createHaversineRouteProvider, type RouteProvider } from '@rideshare/maps';

/**
 * Single shared RouteProvider instance for the process. Currently the
 * MOCK haversine-based provider (see @rideshare/maps) — there is no live
 * Google Maps/Directions API key configured or verifiable in this
 * environment (docs/maps.md). Swapping to a real provider later is a
 * one-line change here; nothing that imports `routeProvider` needs to
 * change.
 */
export const routeProvider: RouteProvider = createHaversineRouteProvider();
