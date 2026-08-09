import { describe, expect, it } from 'vitest';
import { driverLocationPingSchema } from './location';

describe('driverLocationPingSchema', () => {
  it('accepts a minimal ping with only coordinates', () => {
    const result = driverLocationPingSchema.safeParse({ latitude: 40.7128, longitude: -74.006 });
    expect(result.success).toBe(true);
  });

  it('accepts a full ping with heading, speed, accuracy, and timestamp', () => {
    const result = driverLocationPingSchema.safeParse({
      latitude: 40.7128,
      longitude: -74.006,
      heading: 180,
      speed: 12.5,
      accuracy: 8,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range coordinate', () => {
    expect(driverLocationPingSchema.safeParse({ latitude: 999, longitude: -74.006 }).success).toBe(
      false,
    );
  });

  it('rejects a heading outside 0-360', () => {
    const base = { latitude: 40.7128, longitude: -74.006 };
    expect(driverLocationPingSchema.safeParse({ ...base, heading: -1 }).success).toBe(false);
    expect(driverLocationPingSchema.safeParse({ ...base, heading: 361 }).success).toBe(false);
    expect(driverLocationPingSchema.safeParse({ ...base, heading: 360 }).success).toBe(true);
  });

  it('rejects negative speed and accuracy', () => {
    const base = { latitude: 40.7128, longitude: -74.006 };
    expect(driverLocationPingSchema.safeParse({ ...base, speed: -1 }).success).toBe(false);
    expect(driverLocationPingSchema.safeParse({ ...base, accuracy: -1 }).success).toBe(false);
  });

  it('rejects a malformed timestamp', () => {
    const result = driverLocationPingSchema.safeParse({
      latitude: 40.7128,
      longitude: -74.006,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});
