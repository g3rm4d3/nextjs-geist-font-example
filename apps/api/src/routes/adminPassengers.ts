import type { AdminPassengerDetail, AdminPassengerSummary } from '@rideshare/types';
import { Router } from 'express';
import { requireIdParam } from '../lib/params';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import * as adminPassengerService from '../services/adminPassengerService';

export const adminPassengersRouter = Router();

/** Section 14: "Passengers." */
adminPassengersRouter.get(
  '/admin/passengers',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const passengers: AdminPassengerSummary[] = await adminPassengerService.listPassengers();
    sendSuccess(req, res, passengers);
  },
);

/** "Inspect passenger." */
adminPassengersRouter.get(
  '/admin/passengers/:id',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const passengerId = requireIdParam(req.params.id, 'passenger id');
    const detail: AdminPassengerDetail = await adminPassengerService.getPassengerDetail(passengerId);
    sendSuccess(req, res, detail);
  },
);
