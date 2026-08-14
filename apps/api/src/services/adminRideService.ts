import type { AdminRideDetail, AdminRideSummary } from '@rideshare/types';
import { NotFoundError } from '../lib/errors';
import { findRideAdminRowById, listAllRidesForAdmin, type RideAdminRow } from '../repositories/ridesRepository';

type RideStatus = AdminRideSummary['status'];

function toSummary(row: RideAdminRow): AdminRideSummary {
  return {
    id: row.id,
    status: row.status,
    passengerName: `${row.passengerFirstName} ${row.passengerLastName}`,
    driverName: row.driverFirstName && row.driverLastName ? `${row.driverFirstName} ${row.driverLastName}` : null,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    finalFareCents: row.finalFareCents,
  };
}

/** Section 14's "Rides" — every ride regardless of status (the active-
 * only view from Phase 10 stays at GET /admin/rides/active, untouched). */
export async function listRides(statusFilter?: RideStatus): Promise<AdminRideSummary[]> {
  const rows = await listAllRidesForAdmin(undefined, statusFilter);
  return rows.map(toSummary);
}

/** "Inspect ride." */
export async function getRideDetail(rideId: string): Promise<AdminRideDetail> {
  const row = await findRideAdminRowById(rideId);
  if (!row) throw new NotFoundError('Ride not found');

  return {
    ...toSummary(row),
    pickup: {
      coordinate: { latitude: row.pickupLat, longitude: row.pickupLng },
      label: row.pickupAddress,
    },
    destination: {
      coordinate: { latitude: row.destinationLat, longitude: row.destinationLng },
      label: row.destinationAddress,
    },
    estimatedFareCents: row.estimatedFareCents,
    actualDistanceMeters: row.actualDistanceMeters,
    actualDurationSeconds: row.actualDurationSeconds,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancellationReason: row.cancellationReason,
  };
}
