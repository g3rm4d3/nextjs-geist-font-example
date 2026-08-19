import type { NotificationProvider, SendPushInput, SendPushResult } from './types';

/**
 * MOCK / dev-only NotificationProvider — same pattern as
 * @rideshare/maps's MOCK RouteProvider and @rideshare/storage's MOCK
 * StorageProvider. Deterministic and fully in-memory: no network call
 * is ever made, so every push "succeeds" without needing a real
 * device's push token. This is the default in Stage 1 (see
 * apps/api/src/lib/notificationProvider.ts) since this environment has
 * no real mobile device to register a genuine Expo push token from —
 * see createExpoPushProvider for the real implementation this swaps
 * out for once one exists.
 */
export function createMockNotificationProvider(): NotificationProvider {
  return {
    async sendPush(_input: SendPushInput): Promise<SendPushResult> {
      return { status: 'sent' };
    },
  };
}
