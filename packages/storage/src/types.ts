export interface StoreFileInput {
  /** Base64-encoded file bytes. Stage 1 has no multipart/streaming
   * upload path — driver documents are small (a license photo, an
   * insurance PDF), so a single JSON body field is enough. */
  contentBase64: string;
  contentType: string;
  /** A human-meaningful hint folded into the generated key (e.g.
   * "driver-documents/driver-license") — not itself the key. */
  keyPrefix: string;
}

export interface StoredFile {
  /** Opaque reference the caller persists (e.g.
   * driver_documents.storage_key) — never a raw filesystem path or a
   * client-supplied value. */
  storageKey: string;
}

/**
 * Section 13's StorageProvider abstraction. Consumed server-side only
 * (apps/api) so no storage credentials are ever embedded in a mobile
 * client bundle — a driver-app upload goes through the API, never
 * straight to a storage backend.
 */
export interface StorageProvider {
  store(input: StoreFileInput): Promise<StoredFile>;

  /** Resolves a previously stored key back to something a client can
   * fetch content from (a signed URL for a real provider). */
  getUrl(storageKey: string): Promise<string>;

  delete(storageKey: string): Promise<void>;
}
