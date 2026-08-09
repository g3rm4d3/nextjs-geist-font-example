import type { FleetDriverLocation } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { listUsers } from '../repositories/usersRepository';
import { getFleetLocations } from '../services/locationService';

export const adminRouter = Router();

interface AdminUserSummary {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

/**
 * Minimal admin-only endpoint proving requireRole('ADMIN', 'SUPER_ADMIN')
 * actually blocks PASSENGER/DRIVER callers (see
 * src/authorization.test.ts). Real user management is Phase 14.
 */
adminRouter.get(
  '/admin/users',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    const users = await listUsers();
    const summaries: AdminUserSummary[] = users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    }));
    sendSuccess(req, res, summaries);
  },
);

/**
 * Section 6/Phase 6: "Admin App should display virtual drivers on map."
 * Every driver with a location on file (not just ONLINE ones — an admin
 * debugging a missing driver needs to see a stale/offline last-known
 * position too). staleness is precomputed per-row by locationService so
 * the admin UI doesn't need its own clock-skew-sensitive logic.
 */
adminRouter.get(
  '/admin/drivers/locations',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    const locations: FleetDriverLocation[] = await getFleetLocations();
    sendSuccess(req, res, locations);
  },
);
