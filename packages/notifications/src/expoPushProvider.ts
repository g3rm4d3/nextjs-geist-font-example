import type { NotificationProvider, SendPushInput, SendPushResult } from './types';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponseBody {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: unknown[];
}

/**
 * Real NotificationProvider — Expo's push notification service, the
 * natural fit since both apps/passenger-app and apps/driver-app are
 * Expo apps. Unlike a real BackgroundCheckProvider or a real
 * StorageProvider (packages/screening, packages/storage), this one is
 * not merely aspirational: Expo's push endpoint needs no API key or
 * secret for a basic send, so this genuinely makes a live HTTP request
 * — it just has no real device's Expo push token to send to or verify
 * a delivery against in this environment (see docs/notifications.md),
 * which is why the MOCK provider is what actually runs by default (see
 * apps/api/src/lib/notificationProvider.ts).
 */
export function createExpoPushProvider(): NotificationProvider {
  return {
    async sendPush(input: SendPushInput): Promise<SendPushResult> {
      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            to: input.pushToken,
            title: input.title,
            body: input.body,
            data: input.data,
          }),
        });

        const json = (await response.json().catch(() => null)) as ExpoPushResponseBody | null;
        const ticket = Array.isArray(json?.data) ? json?.data[0] : json?.data;

        if (!response.ok || !ticket || ticket.status !== 'ok') {
          return {
            status: 'failed',
            error:
              ticket?.message ??
              ticket?.details?.error ??
              `Expo push request failed with HTTP ${response.status}`,
          };
        }

        return { status: 'sent' };
      } catch (error) {
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error contacting Expo push service',
        };
      }
    },
  };
}
