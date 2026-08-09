import { describe, expect, it } from 'vitest';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  AuthResponse,
  DriverProfileSummary,
  FareEstimate,
  HealthCheckResponse,
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
    };

    expect(summary.vehicle).toBeNull();
  });

  it('accepts a well-formed driver profile summary with a vehicle', () => {
    const summary: DriverProfileSummary = {
      onboardingStatus: 'APPROVED',
      availabilityStatus: 'ONLINE',
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
});
