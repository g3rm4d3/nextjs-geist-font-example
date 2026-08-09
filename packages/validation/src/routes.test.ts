import { describe, expect, it } from 'vitest';
import { routePreviewSchema } from './routes';

describe('routePreviewSchema', () => {
  it('accepts well-formed origin/destination coordinates', () => {
    const result = routePreviewSchema.safeParse({
      origin: { latitude: 40.7128, longitude: -74.006 },
      destination: { latitude: 34.0522, longitude: -118.2437 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    const result = routePreviewSchema.safeParse({
      origin: { latitude: 999, longitude: -74.006 },
      destination: { latitude: 34.0522, longitude: -118.2437 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing destination', () => {
    const result = routePreviewSchema.safeParse({
      origin: { latitude: 40.7128, longitude: -74.006 },
    });
    expect(result.success).toBe(false);
  });
});
