import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { listUsers } from '../repositories/usersRepository';

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
