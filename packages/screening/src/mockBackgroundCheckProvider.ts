import { randomUUID } from 'node:crypto';
import type { BackgroundCheckProvider, BackgroundCheckResult, RunBackgroundCheckInput } from './types';

/** Deterministic test hook, the same spirit as
 * @rideshare/payments's TEST_PAYMENT_METHODS "magic" ids: a license
 * number starting with this prefix (case-insensitive) always fails,
 * so FAILED is exercisable in tests/manual QA without randomness. */
const FORCED_FAILURE_PREFIX = 'mock-fail-';

/**
 * MOCK / dev-only BackgroundCheckProvider — the only implementation
 * this abstraction will ever have in Stage 1 (section 13:
 * "BackgroundCheckProvider = MOCK ONLY"; a real integration is
 * explicitly on the "must NOT activate" list — see
 * docs/document-management.md). Deterministic and fully in-memory: no
 * network call is ever made, and it "completes" synchronously even
 * though the result shape (status/providerReportId/completedAt) mirrors
 * what a real, typically-async provider would eventually report.
 */
export function createMockBackgroundCheckProvider(): BackgroundCheckProvider {
  return {
    async runCheck(input: RunBackgroundCheckInput): Promise<BackgroundCheckResult> {
      const forcedFailure = input.licenseNumber.toLowerCase().startsWith(FORCED_FAILURE_PREFIX);

      return {
        status: forcedFailure ? 'FAILED' : 'PASSED',
        providerReportId: `bgc_mock_${randomUUID()}`,
        completedAt: new Date(),
      };
    },
  };
}
