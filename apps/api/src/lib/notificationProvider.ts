import {
  createExpoPushProvider,
  createMockNotificationProvider,
  type NotificationProvider,
} from '@rideshare/notifications';
import { env } from '../config/env';

/**
 * Single shared NotificationProvider instance for the process — same
 * pattern as paymentProvider.ts/mapProvider.ts. Gated by EXPO_PUSH_ENABLED
 * rather than by the mere presence of a credential (unlike
 * paymentProvider.ts's STRIPE_SECRET_KEY check): Expo's push endpoint
 * needs no credential at all, so "real provider configured" isn't a
 * meaningful signal here — the gate exists purely so this environment's
 * default stays the deterministic MOCK unless someone explicitly opts in.
 */
export const notificationProvider: NotificationProvider = env.EXPO_PUSH_ENABLED
  ? createExpoPushProvider()
  : createMockNotificationProvider();
