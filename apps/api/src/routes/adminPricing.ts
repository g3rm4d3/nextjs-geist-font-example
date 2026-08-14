import type { AdminPricingConfig } from '@rideshare/types';
import { changePricingSchema } from '@rideshare/validation';
import type { Request } from 'express';
import { Router } from 'express';
import type { AuditActorContext } from '../lib/auditContext';
import { UnauthorizedError } from '../lib/errors';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import * as adminPricingService from '../services/adminPricingService';

export const adminPricingRouter = Router();

function actorFrom(req: Request): AuditActorContext {
  if (!req.auth) throw new UnauthorizedError();
  return {
    userId: req.auth.userId,
    role: req.auth.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
  };
}

/** Section 14's "Pricing" — full version history, any admin can view. */
adminPricingRouter.get(
  '/admin/pricing/configs',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const configs: AdminPricingConfig[] = await adminPricingService.listPricing();
    sendSuccess(req, res, configs);
  },
);

/**
 * "Change pricing" — SUPER_ADMIN only. Platform-wide financial impact is
 * exactly the kind of action this phase reserves for SUPER_ADMIN.
 */
adminPricingRouter.post(
  '/admin/pricing/configs',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  adminLimiter,
  validateBody(changePricingSchema),
  async (req, res) => {
    const config: AdminPricingConfig = await adminPricingService.changePricing(req.body, actorFrom(req));
    sendSuccess(req, res, config, 201);
  },
);
