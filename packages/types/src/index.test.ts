import { describe, expect, it } from 'vitest';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  AuthResponse,
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
});
