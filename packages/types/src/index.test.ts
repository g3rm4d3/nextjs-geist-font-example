import { describe, expect, it } from 'vitest';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  AuthResponse,
  CreateRideRequest,
  DriverProfileSummary,
  FareEstimate,
  FleetDriverLocation,
  HealthCheckResponse,
  RecordLocationResult,
  Ride,
} from './index';

describe('shared API types', () => {
  it('accepts a well-formed success envelope', () => {
    const response: ApiSuccessResponse<{ ok: boolean }> = {
      success: true,
      data: { ok: true },
      requestId: 'req_123',
    };

    expect(response.success).toBe(true);
    expect(response.data.ok).toBe(true);
  });

  it('accepts a well-formed error envelope', () => {
    const response: ApiErrorResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
      requestId: 'req_124',
    };

    expect(response.success).toBe(false);
    expect(response.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a well-formed health check response', () => {
    const health: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: 12,
      database: { connected: true, latencyMs: 3 },
    };

    expect(health.status).toBe('ok');
  });

  it('accepts a well-formed auth response', () => {
    const response: AuthResponse = {
      user: { id: 'usr_1', email: 'jane@example.com', role: 'PASSENGER', isActive: true },
      tokens: {
        accessToken: 'a.b.c',
        refreshToken: 'opaque-token',
        accessTokenExpiresInSeconds: 900,
      },
    };

    expect(response.user.role).toBe('PASSENGER');
    expect(response.tokens.accessTokenExpiresInSeconds).toBe(900);
  });

  it('accepts a well-formed fare estimate', () => {
    const estimate: FareEstimate = {
      baseFareCents: 250,
      distanceFareCents: 750,
      timeFareCents: 250,
      bookingFeeCents: 200,
      subtotalCents: 1450,
      minimumFareCents: 500,
      minimumFareApplied: false,
      totalCents: 1450,
      platformCommissionCents: 290,
      driverEarningsCents: 1160,
    };

    expect(estimate.platformCommissionCents + estimate.driverEarningsCents).toBe(
      estimate.totalCents,
    );
  });

  it('accepts a well-formed driver profile summary with no vehicle yet', () => {
    const summary: DriverProfileSummary = {
      onboardingStatus: 'DRAFT',
      availabilityStatus: 'OFFLINE',
      vehicle: null,
      averageRating: null,
      ratingsCount: 0,
    };

    expect(summary.vehicle).toBeNull();
  });

  it('accepts a well-formed driver profile summary with a vehicle', () => {
    const summary: DriverProfileSummary = {
      onboardingStatus: 'APPROVED',
      availabilityStatus: 'ONLINE',
      averageRating: 4.8,
      ratingsCount: 12,
      vehicle: {
        id: 'veh_1',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'Silver',
        licensePlate: 'DEV-1234',
        vin: null,
        seats: 4,
      },
    };

    expect(summary.availabilityStatus).toBe('ONLINE');
  });

  it('accepts a well-formed record-location result, written or skipped', () => {
    const written: RecordLocationResult = {
      location: {
        latitude: 40.7128,
        longitude: -74.006,
        heading: 180,
        speed: 12.5,
        accuracy: 8,
        recordedAt: new Date().toISOString(),
        isStale: false,
      },
      written: true,
    };
    const skipped: RecordLocationResult = { ...written, written: false };

    expect(written.written).toBe(true);
    expect(skipped.written).toBe(false);
  });

  it('accepts a well-formed fleet driver location', () => {
    const entry: FleetDriverLocation = {
      driverId: 'drv_1',
      firstName: 'Dana',
      lastName: 'Driver',
      availabilityStatus: 'ONLINE',
      latitude: 40.7128,
      longitude: -74.006,
      heading: null,
      speed: null,
      accuracy: null,
      recordedAt: new Date().toISOString(),
      isStale: false,
    };

    expect(entry.availabilityStatus).toBe('ONLINE');
  });

  it('accepts a well-formed create-ride request with no fare field', () => {
    const request: CreateRideRequest = {
      pickup: { coordinate: { latitude: 40.7128, longitude: -74.006 }, label: 'Home' },
      destination: { coordinate: { latitude: 40.73, longitude: -73.9925 }, label: 'Work' },
      idempotencyKey: 'idem_1',
    };

    expect(request.idempotencyKey).toBe('idem_1');
    // @ts-expect-error -- a fare must never be part of this request shape (section 3).
    expect(request.estimatedFareCents).toBeUndefined();
  });

  it('accepts a well-formed ride', () => {
    const ride: Ride = {
      id: 'ride_1',
      status: 'SEARCHING_DRIVER',
      pickup: { coordinate: { latitude: 40.7128, longitude: -74.006 }, label: 'Home' },
      destination: { coordinate: { latitude: 40.73, longitude: -73.9925 }, label: 'Work' },
      estimatedDistanceMeters: 5000,
      estimatedDurationSeconds: 900,
      estimatedFareCents: 1450,
      actualDistanceMeters: null,
      actualDurationSeconds: null,
      finalFareCents: null,
      cancellationReason: null,
      cancellationFeeCents: null,
      requestedAt: new Date().toISOString(),
    };

    expect(ride.status).toBe('SEARCHING_DRIVER');
  });
});
