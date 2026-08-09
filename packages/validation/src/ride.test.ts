import { describe, expect, it } from 'vitest';
import { createRideRequestSchema } from './ride';

const VALID_REQUEST = {
  pickup: { coordinate: { latitude: 40.7128, longitude: -74.006 }, label: 'Home' },
  destination: { coordinate: { latitude: 40.73, longitude: -73.9925 }, label: 'Work' },
  idempotencyKey: 'a-client-generated-key',
};

describe('createRideRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(createRideRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it('rejects a missing idempotencyKey', () => {
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = VALID_REQUEST;
    expect(createRideRequestSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('rejects an empty idempotencyKey', () => {
    expect(
      createRideRequestSchema.safeParse({ ...VALID_REQUEST, idempotencyKey: '' }).success,
    ).toBe(false);
  });

  it('rejects a missing pickup label', () => {
    const malformed = { ...VALID_REQUEST, pickup: { ...VALID_REQUEST.pickup, label: '' } };
    expect(createRideRequestSchema.safeParse(malformed).success).toBe(false);
  });

  it('rejects an out-of-range destination coordinate', () => {
    const malformed = {
      ...VALID_REQUEST,
      destination: { ...VALID_REQUEST.destination, coordinate: { latitude: 999, longitude: 0 } },
    };
    expect(createRideRequestSchema.safeParse(malformed).success).toBe(false);
  });

  it('strips an unexpected fare field rather than accepting it', () => {
    const result = createRideRequestSchema.safeParse({
      ...VALID_REQUEST,
      estimatedFareCents: 999999,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('estimatedFareCents');
    }
  });
});
