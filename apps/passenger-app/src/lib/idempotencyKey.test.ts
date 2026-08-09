import { generateIdempotencyKey } from './idempotencyKey';

describe('generateIdempotencyKey', () => {
  it('returns a non-empty string', () => {
    const key = generateIdempotencyKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('returns a different key on each call', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(20);
  });
});
