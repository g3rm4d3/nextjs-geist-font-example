import { createMockStorageProvider, type StorageProvider } from '@rideshare/storage';

/**
 * Single shared StorageProvider instance for the process — same pattern
 * as paymentProvider.ts/mapProvider.ts. Always the MOCK, in-memory
 * provider in Stage 1: no real object-store credentials are configured
 * or verifiable in this environment (see docs/document-management.md).
 * Swapping to a real provider later is a one-line change here; nothing
 * that imports `storageProvider` needs to change.
 */
export const storageProvider: StorageProvider = createMockStorageProvider();
