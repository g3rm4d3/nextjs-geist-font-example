import { describe, expect, it } from 'vitest';
import type { ApiErrorResponse, ApiSuccessResponse, HealthCheckResponse } from './index';

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
});
