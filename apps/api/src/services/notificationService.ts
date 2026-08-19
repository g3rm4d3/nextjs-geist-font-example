import type { AppNotification, NotificationType } from '@rideshare/types';
import { logger } from '../lib/logger';
import { notificationProvider } from '../lib/notificationProvider';
import {
  countUnreadNotifications,
  createNotification,
  deletePushToken,
  findPushTokensForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  upsertPushToken,
  type NotificationRow,
} from '../repositories/notificationsRepository';

function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Section 16's NotificationProvider abstraction, applied: this is the
 * one place in the codebase that turns a domain event into (a) a
 * persisted in-app notification and (b) a best-effort push send. Every
 * caller below (ride/payment/driver-moderation services, the document
 * expiration sweep, the admin support reply endpoint) goes through this
 * — none of them talk to `notificationProvider` or the notifications
 * table directly, so ride/payment/moderation logic stays uncoupled from
 * *how* a notification is delivered, exactly as the spec requires
 * ("do not tightly couple ride logic to a specific push provider").
 *
 * The in-app row insert is the source of truth and can throw (a genuine
 * DB failure); the push-dispatch step below it can't — a missing
 * device, an unreachable Expo endpoint, or any other delivery failure
 * is logged and swallowed, never surfaced to the caller. Every caller
 * of `notify`/the per-event helpers additionally wraps the whole call
 * in its own try/catch (see rideService/matchingService/etc.) — the
 * same "must not fail the primary action" precedent as
 * rideService.requestRide's `startMatching` call.
 */
async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<AppNotification> {
  const row = await createNotification({ userId, type, title, body, data });

  const tokens = await findPushTokensForUser(userId);
  for (const { token } of tokens) {
    try {
      const result = await notificationProvider.sendPush({ pushToken: token, title, body, data });
      if (result.status === 'failed') {
        logger.warn({ userId, type, error: result.error }, 'Push delivery failed for a notification');
      }
    } catch (error) {
      logger.warn({ err: error, userId, type }, 'Push delivery threw for a notification');
    }
  }

  return toAppNotification(row);
}

// ---- Per-event helpers — Phase 16's canonical event list -----------------
// Each wraps `notify` with the event's fixed NotificationType and a
// human-readable title/body built from the caller's already-loaded
// domain data (never re-fetched here); `data` always carries the
// relevant id(s) for client-side deep-linking.

export async function notifyRideRequested(passengerUserId: string, rideId: string): Promise<AppNotification> {
  return notify(
    passengerUserId,
    'ride.requested',
    'Finding you a driver',
    "We're matching you with a nearby driver now.",
    { rideId },
  );
}

export async function notifyRideAccepted(
  passengerUserId: string,
  rideId: string,
  driverFirstName: string,
): Promise<AppNotification> {
  return notify(
    passengerUserId,
    'ride.accepted',
    'Driver assigned',
    `${driverFirstName} accepted your ride and is on the way.`,
    { rideId },
  );
}

export async function notifyDriverApproaching(passengerUserId: string, rideId: string): Promise<AppNotification> {
  return notify(passengerUserId, 'ride.driver_approaching', 'Driver approaching', 'Your driver is almost there.', {
    rideId,
  });
}

export async function notifyDriverArrived(passengerUserId: string, rideId: string): Promise<AppNotification> {
  return notify(
    passengerUserId,
    'ride.driver_arrived',
    'Driver arrived',
    'Your driver is waiting at the pickup location.',
    { rideId },
  );
}

export async function notifyRideStarted(passengerUserId: string, rideId: string): Promise<AppNotification> {
  return notify(passengerUserId, 'ride.started', 'Ride started', "You're on your way to your destination.", {
    rideId,
  });
}

export async function notifyRideCompleted(passengerUserId: string, rideId: string): Promise<AppNotification> {
  return notify(passengerUserId, 'ride.completed', 'Ride completed', 'You have arrived. Thanks for riding with us!', {
    rideId,
  });
}

export async function notifyPaymentStatus(
  passengerUserId: string,
  rideId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED',
): Promise<AppNotification> {
  const body =
    status === 'SUCCEEDED'
      ? 'Your payment was processed successfully.'
      : status === 'FAILED'
        ? 'We were unable to process your payment. Please update your payment method.'
        : 'Your payment was refunded.';
  return notify(passengerUserId, 'payment.status', 'Payment update', body, { rideId, status });
}

export async function notifyDriverApproved(driverUserId: string): Promise<AppNotification> {
  return notify(
    driverUserId,
    'driver.approved',
    "You're approved to drive",
    'Your driver application has been approved. You can now go online.',
  );
}

export async function notifyDriverRejected(driverUserId: string, reason: string): Promise<AppNotification> {
  return notify(
    driverUserId,
    'driver.rejected',
    'Driver application update',
    `Your driver application was not approved. Reason: ${reason}`,
  );
}

export async function notifyDocumentExpiring(driverUserId: string, documentId: string): Promise<AppNotification> {
  return notify(
    driverUserId,
    'document.expiring',
    'Document expiring soon',
    'One of your uploaded documents is expiring soon. Please upload a replacement.',
    { documentId },
  );
}

export async function notifySupportUpdate(userId: string, ticketId: string): Promise<AppNotification> {
  return notify(
    userId,
    'support.update',
    'Support ticket update',
    'Support has replied to your ticket.',
    { ticketId },
  );
}

// ---- Reads / mutations backing apps/api/src/routes/notifications.ts ------

export interface NotificationListResult {
  notifications: AppNotification[];
  unreadCount: number;
}

export async function listOwnNotifications(userId: string): Promise<NotificationListResult> {
  const [rows, unreadCount] = await Promise.all([
    listNotificationsForUser(userId),
    countUnreadNotifications(userId),
  ]);
  return { notifications: rows.map(toAppNotification), unreadCount };
}

export async function markOwnNotificationRead(
  userId: string,
  notificationId: string,
): Promise<AppNotification | undefined> {
  const row = await markNotificationRead(notificationId, userId);
  return row ? toAppNotification(row) : undefined;
}

export async function markAllOwnNotificationsRead(userId: string): Promise<void> {
  await markAllNotificationsRead(userId);
}

export async function registerOwnPushToken(
  userId: string,
  token: string,
  platform?: string,
): Promise<void> {
  await upsertPushToken({ userId, token, platform });
}

export async function unregisterOwnPushToken(userId: string, token: string): Promise<boolean> {
  return deletePushToken(token, userId);
}
