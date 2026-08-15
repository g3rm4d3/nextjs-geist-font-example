import { createMockBackgroundCheckProvider, type BackgroundCheckProvider } from '@rideshare/screening';

/**
 * Single shared BackgroundCheckProvider instance for the process.
 * Unlike paymentProvider.ts, there is no real-provider branch here at
 * all — section 13 is explicit that BackgroundCheckProvider is MOCK
 * ONLY for the whole of Stage 1, not just when a credential happens to
 * be missing (see docs/document-management.md).
 */
export const backgroundCheckProvider: BackgroundCheckProvider = createMockBackgroundCheckProvider();
