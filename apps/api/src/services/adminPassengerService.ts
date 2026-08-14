import type { AdminPassengerDetail, AdminPassengerSummary } from '@rideshare/types';
import { NotFoundError } from '../lib/errors';
import { countRidesForPassenger } from '../repositories/ridesRepository';
import { findPassengerAdminRowById, listPassengers as listPassengerRows, type PassengerAdminRow } from '../repositories/usersRepository';

function toSummary(row: PassengerAdminRow): AdminPassengerSummary {
  return {
    id: row.id,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isActive: row.isActive,
    averageRating: row.averageRating !== null ? Number(row.averageRating) : null,
    ratingsCount: row.ratingsCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Section 14: "Passengers." */
export async function listPassengers(): Promise<AdminPassengerSummary[]> {
  const rows = await listPassengerRows();
  return rows.map(toSummary);
}

/** "Inspect passenger." */
export async function getPassengerDetail(passengerId: string): Promise<AdminPassengerDetail> {
  const row = await findPassengerAdminRowById(passengerId);
  if (!row) throw new NotFoundError('Passenger not found');

  const totalRides = await countRidesForPassenger(passengerId);

  return {
    ...toSummary(row),
    totalRides,
    defaultTestPaymentMethodId: row.defaultTestPaymentMethodId,
  };
}
