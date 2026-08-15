import { describe, expect, it } from 'vitest';
import { createMockBackgroundCheckProvider } from './mockBackgroundCheckProvider';

const BASE_INPUT = {
  driverId: 'driver-1',
  fullName: 'Jamie Rivera',
  licenseNumber: 'DL-123456',
  licenseState: 'CA',
};

describe('createMockBackgroundCheckProvider', () => {
  it('passes by default', async () => {
    const provider = createMockBackgroundCheckProvider();
    const result = await provider.runCheck(BASE_INPUT);
    expect(result.status).toBe('PASSED');
    expect(result.providerReportId).toMatch(/^bgc_mock_/);
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('fails deterministically for the mock-fail- license number prefix (test hook)', async () => {
    const provider = createMockBackgroundCheckProvider();
    const result = await provider.runCheck({ ...BASE_INPUT, licenseNumber: 'MOCK-FAIL-000001' });
    expect(result.status).toBe('FAILED');
  });

  it('the forced-failure prefix match is case-insensitive', async () => {
    const provider = createMockBackgroundCheckProvider();
    const result = await provider.runCheck({ ...BASE_INPUT, licenseNumber: 'mock-fail-anything' });
    expect(result.status).toBe('FAILED');
  });

  it('two runs never reuse the same providerReportId', async () => {
    const provider = createMockBackgroundCheckProvider();
    const first = await provider.runCheck(BASE_INPUT);
    const second = await provider.runCheck(BASE_INPUT);
    expect(first.providerReportId).not.toBe(second.providerReportId);
  });
});
