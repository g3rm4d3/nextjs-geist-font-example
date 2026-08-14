import type { AdminDriverEarningsRow } from '@rideshare/types';
import {
  listDriverEarningsBreakdown,
  type DriverEarningsBreakdownRow,
} from '../repositories/earningsRepository';

/** SUM()/COUNT() come back from Postgres as strings — see
 * earningsRepository's own toTotals for why Number(...) is safe here. */
function toAdminRow(row: DriverEarningsBreakdownRow): AdminDriverEarningsRow {
  return {
    driverId: row.driverId,
    driverName: `${row.driverFirstName} ${row.driverLastName}`,
    rideCount: row.rideCount,
    grossFareCents: Number(row.grossFareCents ?? 0),
    platformCommissionCents: Number(row.platformCommissionCents ?? 0),
    driverGrossEarningsCents: Number(row.driverGrossEarningsCents ?? 0),
  };
}

/**
 * Section 14's "Earnings" per-driver breakdown — the drill-down
 * docs/financial-ledger.md (Phase 12) deferred to this phase. Platform
 * totals with Today/Week/Month windows already exist at GET
 * /admin/revenue (Phase 12); this is additive, not a replacement.
 */
export async function listDriverEarningsForAdmin(): Promise<AdminDriverEarningsRow[]> {
  const rows = await listDriverEarningsBreakdown();
  return rows.map(toAdminRow);
}
