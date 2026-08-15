import { describe, expect, it } from 'vitest';
import { createMockStorageProvider } from './mockStorageProvider';

describe('createMockStorageProvider', () => {
  it('stores a file and returns an opaque storage key prefixed by keyPrefix', async () => {
    const provider = createMockStorageProvider();
    const { storageKey } = await provider.store({
      contentBase64: Buffer.from('hello world').toString('base64'),
      contentType: 'image/jpeg',
      keyPrefix: 'driver-documents/driver-license',
    });

    expect(storageKey.startsWith('driver-documents/driver-license/')).toBe(true);
  });

  it('resolves a stored key back to a data: URL carrying the original bytes', async () => {
    const provider = createMockStorageProvider();
    const contentBase64 = Buffer.from('hello world').toString('base64');
    const { storageKey } = await provider.store({
      contentBase64,
      contentType: 'image/jpeg',
      keyPrefix: 'driver-documents/driver-license',
    });

    const url = await provider.getUrl(storageKey);
    expect(url).toBe(`data:image/jpeg;base64,${contentBase64}`);
  });

  it('throws for an unknown storage key', async () => {
    const provider = createMockStorageProvider();
    await expect(provider.getUrl('nonexistent/key')).rejects.toThrow();
  });

  it('two different stores of identical content get distinct keys', async () => {
    const provider = createMockStorageProvider();
    const input = {
      contentBase64: Buffer.from('same content').toString('base64'),
      contentType: 'application/pdf',
      keyPrefix: 'driver-documents/insurance',
    };
    const first = await provider.store(input);
    const second = await provider.store(input);
    expect(first.storageKey).not.toBe(second.storageKey);
  });

  it('deleting a key makes it unresolvable', async () => {
    const provider = createMockStorageProvider();
    const { storageKey } = await provider.store({
      contentBase64: Buffer.from('data').toString('base64'),
      contentType: 'image/png',
      keyPrefix: 'driver-documents/profile-photo',
    });

    await provider.delete(storageKey);
    await expect(provider.getUrl(storageKey)).rejects.toThrow();
  });

  it('providers are independent — one instance does not see another instance\'s files', async () => {
    const providerA = createMockStorageProvider();
    const providerB = createMockStorageProvider();
    const { storageKey } = await providerA.store({
      contentBase64: Buffer.from('a').toString('base64'),
      contentType: 'text/plain',
      keyPrefix: 'test',
    });

    await expect(providerB.getUrl(storageKey)).rejects.toThrow();
  });
});
