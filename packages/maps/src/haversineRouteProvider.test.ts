import { describe, expect, it } from 'vitest';
import { createHaversineRouteProvider } from './haversineRouteProvider';
import type { Coordinate } from './types';

describe('createHaversineRouteProvider', () => {
  it('returns zero distance and duration for identical points', async () => {
    const provider = createHaversineRouteProvider();
    const point: Coordinate = { latitude: 40.7128, longitude: -74.006 };

    const route = await provider.getRoute(point, point);

    expect(route.distanceMeters).toBe(0);
    expect(route.durationSeconds).toBe(0);
  });

  it('computes a plausible road-distance estimate for one degree of latitude', async () => {
    // One degree of latitude is ~111.19 km everywhere on Earth — a fixed,
    // independently-verifiable geometric fact, unlike two arbitrary named
    // cities' "real" driving distance (which this mock isn't computing
    // anyway). With the 1.3x road-distance correction factor applied,
    // expect roughly 111.19 * 1.3 ≈ 144.5 km.
    const provider = createHaversineRouteProvider();
    const origin: Coordinate = { latitude: 0, longitude: 0 };
    const destination: Coordinate = { latitude: 1, longitude: 0 };

    const route = await provider.getRoute(origin, destination);

    expect(route.distanceMeters).toBeGreaterThan(140_000);
    expect(route.distanceMeters).toBeLessThan(149_000);
  });

  it('is symmetric — origin→destination equals destination→origin', async () => {
    const provider = createHaversineRouteProvider();
    const a: Coordinate = { latitude: 34.0522, longitude: -118.2437 };
    const b: Coordinate = { latitude: 37.7749, longitude: -122.4194 };

    const forward = await provider.getRoute(a, b);
    const backward = await provider.getRoute(b, a);

    expect(forward).toEqual(backward);
  });

  it('derives duration from distance using the configured average speed', async () => {
    const slow = createHaversineRouteProvider({ averageSpeedKmh: 10 });
    const fast = createHaversineRouteProvider({ averageSpeedKmh: 60 });
    const origin: Coordinate = { latitude: 0, longitude: 0 };
    const destination: Coordinate = { latitude: 0.5, longitude: 0.5 };

    const slowRoute = await slow.getRoute(origin, destination);
    const fastRoute = await fast.getRoute(origin, destination);

    expect(slowRoute.distanceMeters).toBe(fastRoute.distanceMeters);
    expect(slowRoute.durationSeconds).toBeGreaterThan(fastRoute.durationSeconds);
    // 6x the speed should mean roughly 1/6th the duration.
    expect(slowRoute.durationSeconds / fastRoute.durationSeconds).toBeCloseTo(6, 0);
  });

  it('returns integer distance and duration values', async () => {
    const provider = createHaversineRouteProvider();
    const route = await provider.getRoute(
      { latitude: 12.3456, longitude: 45.6789 },
      { latitude: 13.4567, longitude: 46.789 },
    );

    expect(Number.isInteger(route.distanceMeters)).toBe(true);
    expect(Number.isInteger(route.durationSeconds)).toBe(true);
  });
});
