import type { AdminDashboardSummary } from '@rideshare/types';
import { countPendingDocuments } from '../repositories/documentsRepository';
import { countPendingDriverApplications } from '../repositories/driversRepository';
import { countActiveRides, countRidesRequestedSince } from '../repositories/ridesRepository';
import { countOpenTickets } from '../repositories/supportRepository';
import { countDrivers, countPassengers } from '../repositories/usersRepository';
import { getPlatformRevenueSummary } from './earningsService';

function startOfUtcDay(reference: Date): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
}

/**
 * Section 14's "Dashboard" — one-call summary of the counts every other
 * section's list would otherwise make an admin count by hand. Every
 * figure here is computed fresh (no cached/denormalized totals table),
 * fine at Stage 1's scale — see docs/admin-application.md.
 */
export async function getDashboardSummary(): Promise<AdminDashboardSummary> {
  const today = startOfUtcDay(new Date());

  const [
    totalPassengers,
    totalDrivers,
    pendingDriverApplications,
    pendingDocuments,
    activeRideCount,
    openSupportTicketCount,
    todayRideCount,
    revenue,
  ] = await Promise.all([
    countPassengers(),
    countDrivers(),
    countPendingDriverApplications(),
    countPendingDocuments(),
    countActiveRides(),
    countOpenTickets(),
    countRidesRequestedSince(today),
    getPlatformRevenueSummary(),
  ]);

  return {
    totalPassengers,
    totalDrivers,
    pendingDriverApplications,
    pendingDocuments,
    activeRideCount,
    openSupportTicketCount,
    todayRideCount,
    todayPlatformCommissionCents: revenue.today.platformCommissionCents,
  };
}
