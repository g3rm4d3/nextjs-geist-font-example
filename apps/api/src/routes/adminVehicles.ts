import type { AdminVehicleSummary } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimit';
import { listAllVehicles } from '../repositories/driversRepository';

export const adminVehiclesRouter = Router();

/** Section 14's "Vehicles" — read-only: nothing in Stage 1 lets an
 * admin edit or deactivate a vehicle directly, only the driver who owns
 * it (Phase 5's upsertVehicleForDriver). */
adminVehiclesRouter.get(
  '/admin/vehicles',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  adminLimiter,
  async (req, res) => {
    const rows = await listAllVehicles();
    const vehicles: AdminVehicleSummary[] = rows.map((row) => ({
      id: row.id,
      driverId: row.driverId,
      driverName: `${row.driverFirstName} ${row.driverLastName}`,
      make: row.make,
      model: row.model,
      year: row.year,
      color: row.color,
      licensePlate: row.licensePlate,
      isActive: row.isActive,
    }));
    sendSuccess(req, res, vehicles);
  },
);
