import { formatDistanceMiles, formatDurationMinutes } from './format';

describe('formatDistanceMiles', () => {
  it('converts meters to miles with one decimal place', () => {
    expect(formatDistanceMiles(1609.344)).toBe('1.0 mi');
    expect(formatDistanceMiles(0)).toBe('0.0 mi');
    expect(formatDistanceMiles(8046.72)).toBe('5.0 mi');
  });
});

describe('formatDurationMinutes', () => {
  it('rounds seconds to the nearest minute', () => {
    expect(formatDurationMinutes(90)).toBe('2 min');
    expect(formatDurationMinutes(600)).toBe('10 min');
  });

  it('never rounds down to zero minutes', () => {
    expect(formatDurationMinutes(10)).toBe('1 min');
  });

  it('uses singular "min" for exactly one minute', () => {
    expect(formatDurationMinutes(60)).toBe('1 min');
  });
});
