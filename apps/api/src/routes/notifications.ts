import type { AppNotification } from '@rideshare/types';
import { registerPushTokenSchema } from '@rideshare/validation';
import { Router } from 'express';
import { NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { notificationLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as notificationService from '../services/notificationService';
import type { NotificationListResult } from '../services/notificationService';

export const notificationsRouter = Router();

/** Section 16's "implement in-app notifications" — a passenger's or
 * driver's own list, most recent first, plus an unread badge count. */
notificationsRouter.get(
  '/notifications',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  notificationLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const result: NotificationListResult = await notificationService.listOwnNotifications(req.auth.userId);
    sendSuccess(req, res, result);
  },
);

notificationsRouter.post(
  '/notifications/:id/read',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  notificationLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const notificationId = requireIdParam(req.params.id, 'notification id');
    const notification: AppNotification | undefined = await notificationService.markOwnNotificationRead(
      req.auth.userId,
      notificationId,
    );
    if (!notification) throw new NotFoundError('Notification not found');
    sendSuccess(req, res, notification);
  },
);

notificationsRouter.post(
  '/notifications/read-all',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  notificationLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    await notificationService.markAllOwnNotificationsRead(req.auth.userId);
    sendSuccess(req, res, { success: true });
  },
);

/** Registers (or re-homes — see packages/database's pushTokens schema
 * comment) this device's Expo push token to the authenticated user. */
notificationsRouter.post(
  '/notifications/push-token',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  notificationLimiter,
  validateBody(registerPushTokenSchema),
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    await notificationService.registerOwnPushToken(req.auth.userId, req.body.token, req.body.platform);
    sendSuccess(req, res, { success: true }, 201);
  },
);

/** Unregisters a device's push token, e.g. on logout — see
 * notificationsRepository.deletePushToken's own comment on why this is
 * scoped to the token's current owner. `token` comes in as a query
 * param (a DELETE body is unconventional and unsupported by
 * express.json() without extra config), validated for shape the same
 * way registerPushTokenSchema does. */
notificationsRouter.delete(
  '/notifications/push-token',
  requireAuth,
  requireRole('PASSENGER', 'DRIVER'),
  notificationLimiter,
  async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const token = req.query.token;
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new ValidationError('token query parameter is required');
    }
    await notificationService.unregisterOwnPushToken(req.auth.userId, token);
    sendSuccess(req, res, { success: true });
  },
);
