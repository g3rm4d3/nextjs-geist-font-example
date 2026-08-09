import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { locationPingKeyGenerator } from './rateLimit';

/**
 * Regression coverage for the bug the Phase 6 50-driver simulator caught
 * immediately: an IP-keyed limiter on POST /drivers/me/location throttles
 * every driver behind that IP together, not each driver individually.
 * locationPingKeyGenerator must key by the authenticated driver, so two
 * different drivers sharing one IP get two independent counters.
 */
describe('locationPingKeyGenerator', () => {
  it('keys by driver identity, not IP', () => {
    const driverA = { auth: { userId: 'drv_a', role: 'DRIVER' }, ip: '127.0.0.1' } as Request;
    const driverB = { auth: { userId: 'drv_b', role: 'DRIVER' }, ip: '127.0.0.1' } as Request;

    expect(locationPingKeyGenerator(driverA)).toBe('drv_a');
    expect(locationPingKeyGenerator(driverB)).toBe('drv_b');
    expect(locationPingKeyGenerator(driverA)).not.toBe(locationPingKeyGenerator(driverB));
  });

  it('falls back to IP if req.auth is somehow missing', () => {
    const request = { ip: '203.0.113.5' } as Request;
    expect(locationPingKeyGenerator(request)).toBe('203.0.113.5');
  });
});
