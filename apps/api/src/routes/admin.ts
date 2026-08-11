import type { AdminActiveRide, FleetDriverLocation } from '@rideshare/types';
import { Router } from 'express';
import { sendSuccess } from '../lib/respond';
import { toVehicle } from '../lib/vehicleMapper';
import { requireAuth, requireRole } from '../middleware/auth';
import { findActiveVehicleForDriver } from '../repositories/driversRepository';
import { listActiveRides } from '../repositories/ridesRepository';
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

/**
 * Section 10: "Admin: show active rides." A driver's active vehicle is
 * looked up per-row (only for rows that have a driver assigned) rather
 * than joined in the repository query — see listActiveRides's own
 * comment for why that's the right trade-off at Stage 1's scale.
 */
adminRouter.get(
  '/admin/rides/active',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    const rows = await listActiveRides();
    const rides: AdminActiveRide[] = await Promise.all(
      rows.map(async (row) => {
        const vehicleRow = row.driverId ? await findActiveVehicleForDriver(row.driverId) : undefined;
        return {
          id: row.id,
          status: row.status,
          passengerName: `${row.passengerFirstName} ${row.passengerLastName}`,
          driverName:
            row.driverFirstName && row.driverLastName
              ? `${row.driverFirstName} ${row.driverLastName}`
              : null,
          vehicle: vehicleRow ? toVehicle(vehicleRow) : null,
          pickup: {
            coordinate: { latitude: row.pickupLat, longitude: row.pickupLng },
            label: row.pickupAddress,
          },
          destination: {
            coordinate: { latitude: row.destinationLat, longitude: row.destinationLng },
            label: row.destinationAddress,
          },
          requestedAt: row.requestedAt.toISOString(),
        };
      }),
    );
    sendSuccess(req, res, rides);
  },
);
