import type { NamedPoint } from '../context/RideDraftContext';
import { filterDestinations } from './filterDestinations';

const DESTINATIONS: NamedPoint[] = [
  { label: 'Central Library', coordinate: { latitude: 0, longitude: 0 } },
  { label: 'City Market', coordinate: { latitude: 1, longitude: 1 } },
  { label: 'Convention Center', coordinate: { latitude: 2, longitude: 2 } },
];

describe('filterDestinations', () => {
  it('returns everything for an empty query', () => {
    expect(filterDestinations(DESTINATIONS, '')).toHaveLength(3);
    expect(filterDestinations(DESTINATIONS, '   ')).toHaveLength(3);
  });

  it('filters case-insensitively by substring', () => {
    expect(filterDestinations(DESTINATIONS, 'market')).toEqual([DESTINATIONS[1]]);
    expect(filterDestinations(DESTINATIONS, 'CENTRAL')).toEqual([DESTINATIONS[0]]);
  });

  it('matches a substring shared by multiple entries', () => {
    // "cent" only in "Central Library" here — check a substring that hits two.
    expect(filterDestinations(DESTINATIONS, 'c')).toHaveLength(3);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterDestinations(DESTINATIONS, 'zzz')).toEqual([]);
  });
});
