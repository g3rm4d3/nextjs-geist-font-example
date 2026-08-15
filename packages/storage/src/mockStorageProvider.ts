import { randomUUID } from 'node:crypto';
import type { StorageProvider, StoreFileInput, StoredFile } from './types';

/**
 * MOCK / dev-only StorageProvider — same pattern as @rideshare/maps's
 * MOCK RouteProvider and @rideshare/payments's MOCK PaymentProvider.
 * Keeps every stored file's bytes in an in-memory Map keyed by a
 * generated storageKey; nothing is written to disk or any real object
 * store. This means stored content does not survive a process restart
 * and is never shared across API instances — acceptable for Stage 1's
 * "development and technical validation only" scope (see
 * docs/document-management.md), never something a real deployment
 * would rely on. Swap in a real provider (e.g. backed by S3 or GCS)
 * later by implementing StorageProvider — nothing that calls store()/
 * getUrl() needs to change.
 */
export function createMockStorageProvider(): StorageProvider {
  const files = new Map<string, StoreFileInput>();

  return {
    async store(input: StoreFileInput): Promise<StoredFile> {
      const storageKey = `${input.keyPrefix}/${randomUUID()}`;
      files.set(storageKey, input);
      return { storageKey };
    },

    async getUrl(storageKey: string): Promise<string> {
      const file = files.get(storageKey);
      if (!file) throw new Error(`No mock-stored file for key: ${storageKey}`);
      // A real provider would return a signed, time-limited URL; the
      // MOCK provider has no network endpoint to point at, so it
      // reconstructs the original bytes as a data: URI instead —
      // still something a client can render/download directly.
      return `data:${file.contentType};base64,${file.contentBase64}`;
    },

    async delete(storageKey: string): Promise<void> {
      files.delete(storageKey);
    },
  };
}
