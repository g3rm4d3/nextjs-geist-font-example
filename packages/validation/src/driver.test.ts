import { describe, expect, it } from 'vitest';
import { updateAvailabilitySchema, upsertVehicleSchema } from './driver';

describe('updateAvailabilitySchema', () => {
  it('accepts ONLINE and OFFLINE', () => {
    expect(updateAvailabilitySchema.safeParse({ status: 'ONLINE' }).success).toBe(true);
    expect(updateAvailabilitySchema.safeParse({ status: 'OFFLINE' }).success).toBe(true);
  });

  it('rejects BUSY — only the matching system may set it', () => {
    expect(updateAvailabilitySchema.safeParse({ status: 'BUSY' }).success).toBe(false);
  });

  it('rejects an unknown status string', () => {
    expect(updateAvailabilitySchema.safeParse({ status: 'AWAY' }).success).toBe(false);
  });
});

describe('upsertVehicleSchema', () => {
  const VALID_VEHICLE = {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    color: 'Silver',
    licensePlate: 'DEV-1234',
    seats: 4,
  };

  it('accepts a well-formed vehicle without a VIN', () => {
    expect(upsertVehicleSchema.safeParse(VALID_VEHICLE).success).toBe(true);
  });

  it('accepts a well-formed vehicle with a VIN', () => {
    const result = upsertVehicleSchema.safeParse({ ...VALID_VEHICLE, vin: '1HGCM82633A004352' });
    expect(result.success).toBe(true);
  });

  it('rejects a year outside the plausible range', () => {
    expect(upsertVehicleSchema.safeParse({ ...VALID_VEHICLE, year: 1900 }).success).toBe(false);
    expect(upsertVehicleSchema.safeParse({ ...VALID_VEHICLE, year: 2101 }).success).toBe(false);
  });

  it('rejects non-positive seats', () => {
    expect(upsertVehicleSchema.safeParse({ ...VALID_VEHICLE, seats: 0 }).success).toBe(false);
  });

  it('rejects a missing licensePlate', () => {
    const { licensePlate: _licensePlate, ...withoutPlate } = VALID_VEHICLE;
    expect(upsertVehicleSchema.safeParse(withoutPlate).success).toBe(false);
  });
});
