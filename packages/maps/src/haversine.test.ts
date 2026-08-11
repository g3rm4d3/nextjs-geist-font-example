import { describe, expect, it } from 'vitest';
import { haversineDistanceMeters } from './haversine';
import type { Coordinate } from './types';

describe('haversineDistanceMeters', () => {
  it('returns zero for identical points', () => {
    const point: Coordinate = { latitude: 40.7128, longitude: -74.006 };
    expect(haversineDistanceMeters(point, point)).toBe(0);
  });

  it('computes ~111.19km for one degree of latitude, independent of the road-distance correction', () => {
    const origin: Coordinate = { latitude: 0, longitude: 0 };
    const destination: Coordinate = { latitude: 1, longitude: 0 };

    const distance = haversineDistanceMeters(origin, destination);

    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a: Coordinate = { latitude: 34.0522, longitude: -118.2437 };
    const b: Coordinate = { latitude: 37.7749, longitude: -122.4194 };

    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('satisfies the triangle inequality for three arbitrary points', () => {
    const a: Coordinate = { latitude: 40.7128, longitude: -74.006 };
    const b: Coordinate = { latitude: 40.73, longitude: -73.9925 };
    const c: Coordinate = { latitude: 40.75, longitude: -73.98 };

    const ab = haversineDistanceMeters(a, b);
    const bc = haversineDistanceMeters(b, c);
    const ac = haversineDistanceMeters(a, c);

    expect(ac).toBeLessThanOrEqual(ab + bc + 1e-6);
  });
});
