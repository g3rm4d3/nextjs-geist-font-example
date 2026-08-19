import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpoPushProvider } from './expoPushProvider';

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
    }),
  );
}

describe('createExpoPushProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a real HTTP request to the Expo push endpoint with the expected shape', async () => {
    mockFetchOnce({ ok: true, body: { data: { status: 'ok', id: 'ticket-1' } } });
    const provider = createExpoPushProvider();

    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[abc]',
      title: 'Driver assigned',
      body: 'A driver is on the way',
      data: { rideId: 'ride-1' },
    });

    expect(result).toEqual({ status: 'sent' });
    expect(fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          to: 'ExponentPushToken[abc]',
          title: 'Driver assigned',
          body: 'A driver is on the way',
          data: { rideId: 'ride-1' },
        }),
      }),
    );
  });

  it('reports failed when Expo returns a ticket-level error', async () => {
    mockFetchOnce({
      ok: true,
      body: { data: { status: 'error', message: 'DeviceNotRegistered' } },
    });
    const provider = createExpoPushProvider();

    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[stale]',
      title: 'Test',
      body: 'Test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('DeviceNotRegistered');
  });

  it('reports failed on a non-2xx HTTP response', async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });
    const provider = createExpoPushProvider();

    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[x]',
      title: 'Test',
      body: 'Test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('500');
  });

  it('reports failed (not throwing) when the network call itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network unreachable')),
    );
    const provider = createExpoPushProvider();

    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[x]',
      title: 'Test',
      body: 'Test',
    });

    expect(result).toEqual({ status: 'failed', error: 'network unreachable' });
  });
});
