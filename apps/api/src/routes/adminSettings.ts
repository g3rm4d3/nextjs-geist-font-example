import type { AdminSystemSetting } from '@rideshare/types';
import { upsertSystemSettingSchema } from '@rideshare/validation';
import type { Request } from 'express';
import { Router } from 'express';
import type { AuditActorContext } from '../lib/auditContext';
import { UnauthorizedError } from '../lib/errors';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminSettingsService from '../services/adminSettingsService';

export const adminSettingsRouter = Router();

function actorFrom(req: Request): AuditActorContext {
  if (!req.auth) throw new UnauthorizedError();
  return {
    userId: req.auth.userId,
    role: req.auth.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
  };
}

/** Section 14's "System Settings" — any admin can view. */
adminSettingsRouter.get(
  '/admin/settings',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const settings: AdminSystemSetting[] = await adminSettingsService.listSystemSettings();
    sendSuccess(req, res, settings);
  },
);

/** Writing platform settings is SUPER_ADMIN only, same reasoning as
 * pricing — platform-wide effect, not routine moderation. */
adminSettingsRouter.put(
  '/admin/settings/:key',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  adminLimiter,
  validateBody(upsertSystemSettingSchema),
  async (req, res) => {
    const key = requireIdParam(req.params.key, 'setting key');
    const setting: AdminSystemSetting = await adminSettingsService.upsertSystemSetting(
      key,
      req.body,
      actorFrom(req),
    );
    sendSuccess(req, res, setting);
  },
);
