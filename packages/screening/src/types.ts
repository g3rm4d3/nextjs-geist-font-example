export interface RunBackgroundCheckInput {
  driverId: string;
  fullName: string;
  licenseNumber: string;
  licenseState: string;
}

export type BackgroundCheckOutcome = 'PASSED' | 'FAILED';

export interface BackgroundCheckResult {
  status: BackgroundCheckOutcome;
  /** Provider-safe opaque reference — never raw report contents
   * (criminal history, driving record detail, etc.), mirroring
   * PaymentProvider's providerPaymentIntentId. */
  providerReportId: string;
  completedAt: Date;
}

/**
 * Section 13's BackgroundCheckProvider abstraction. Explicitly
 * MOCK ONLY for the whole of Stage 1 (section 13: "BackgroundCheckProvider
 * = MOCK ONLY") — unlike PaymentProvider, there is no real,
 * even-TEST-MODE implementation to build here; a real integration is
 * one of the items this platform must NOT activate at this stage (see
 * docs/document-management.md's [BACKGROUND CHECK INTEGRATION REQUIRED]
 * marker). Consumed server-side only (apps/api).
 */
export interface BackgroundCheckProvider {
  runCheck(input: RunBackgroundCheckInput): Promise<BackgroundCheckResult>;
}
