export interface SendPushInput {
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type SendPushOutcome = 'sent' | 'failed';

export interface SendPushResult {
  status: SendPushOutcome;
  error?: string;
}

/**
 * Section 13's NotificationProvider abstraction (Phase 16), scoped to
 * push delivery only — in-app notifications are just database rows
 * (apps/api's notificationService owns those directly), so this
 * interface is the entire surface any ride/payment/driver-moderation
 * code path could possibly be coupled to. In practice none of them are:
 * every call site goes through notificationService.notify(...), never
 * this interface directly, satisfying "do not tightly couple ride logic
 * to a specific push provider."
 */
export interface NotificationProvider {
  sendPush(input: SendPushInput): Promise<SendPushResult>;
}
