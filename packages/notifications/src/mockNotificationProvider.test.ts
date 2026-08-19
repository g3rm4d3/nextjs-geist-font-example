import { describe, expect, it } from 'vitest';
import { createMockNotificationProvider } from './mockNotificationProvider';

describe('createMockNotificationProvider', () => {
  it('always reports sent, without making any network call', async () => {
    const provider = createMockNotificationProvider();
    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[does-not-matter]',
      title: 'Test',
      body: 'Test body',
    });
    expect(result).toEqual({ status: 'sent' });
  });

  it('accepts an arbitrary data payload without complaint', async () => {
    const provider = createMockNotificationProvider();
    const result = await provider.sendPush({
      pushToken: 'ExponentPushToken[x]',
      title: 'Test',
      body: 'Test body',
      data: { rideId: 'abc-123' },
    });
    expect(result.status).toBe('sent');
  });
});
