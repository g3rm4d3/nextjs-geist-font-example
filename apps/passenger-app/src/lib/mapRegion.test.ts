import { computeRegionForTwoPoints } from './mapRegion';

describe('computeRegionForTwoPoints', () => {
  it('centers on the midpoint of the two points', () => {
    const region = computeRegionForTwoPoints(
      { latitude: 40, longitude: -74 },
      { latitude: 41, longitude: -73 },
    );

    expect(region.latitude).toBeCloseTo(40.5, 5);
    expect(region.longitude).toBeCloseTo(-73.5, 5);
  });

  it('sizes the delta to comfortably fit both points, not just their span', () => {
    const region = computeRegionForTwoPoints(
      { latitude: 40, longitude: -74 },
      { latitude: 41, longitude: -73 },
    );

    expect(region.latitudeDelta).toBeGreaterThan(1);
    expect(region.longitudeDelta).toBeGreaterThan(1);
  });

  it('never returns a delta below the minimum, even for identical points', () => {
    const point = { latitude: 40.7128, longitude: -74.006 };
    const region = computeRegionForTwoPoints(point, point);

    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });
});
