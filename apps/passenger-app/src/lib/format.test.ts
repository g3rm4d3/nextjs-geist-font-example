import { formatCents, formatDistanceMiles, formatDurationMinutes } from './format';

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

describe('formatCents', () => {
  it('formats whole-dollar cent amounts with two decimal places', () => {
    expect(formatCents(500)).toBe('$5.00');
    expect(formatCents(100)).toBe('$1.00');
  });

  it('formats non-whole-dollar cent amounts', () => {
    expect(formatCents(865)).toBe('$8.65');
    expect(formatCents(173)).toBe('$1.73');
  });

  it('formats zero cents', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
});
