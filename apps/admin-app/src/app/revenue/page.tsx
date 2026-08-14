'use client';

import type { AdminDriverEarningsRow, EarningsPeriodTotals, PlatformRevenueSummary } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getPlatformRevenue, listAdminDriverEarnings } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

const PERIODS: { key: keyof PlatformRevenueSummary; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'allTime', label: 'All time' },
];

function RevenueCard({ label, totals }: { label: string; totals: EarningsPeriodTotals }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-emerald-600">
        {formatCents(totals.platformCommissionCents)}
      </p>
      <p className="text-xs text-slate-500">platform commission</p>
      <dl className="mt-4 space-y-1 text-sm text-slate-600">
        <div className="flex justify-between">
          <dt>Rides</dt>
          <dd className="font-medium text-slate-900">{totals.rideCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Gross fare</dt>
          <dd className="font-medium text-slate-900">{formatCents(totals.grossFareCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Driver earnings</dt>
          <dd className="font-medium text-slate-900">{formatCents(totals.driverGrossEarningsCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Section 12/14: "Admin sees platform test revenue" plus the per-driver
 * drill-down docs/financial-ledger.md (Phase 12) deferred to this
 * phase. Today/Week/Month/All-time totals fetched once on load with a
 * manual refresh — revenue has no reason to be watched second-by-second
 * unlike the fleet map/active rides pages. Every figure here is Stripe
 * TEST MODE money from fictional test rides — never real revenue
 * (section 1/11).
 */
export default function RevenuePage() {
  const { accessToken } = useAdminAuth();
  const [summary, setSummary] = useState<PlatformRevenueSummary | null>(null);
  const [byDriver, setByDriver] = useState<AdminDriverEarningsRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [revenue, breakdown] = await Promise.all([
          getPlatformRevenue(token),
          listAdminDriverEarnings(token),
        ]);
        if (!cancelled) {
          setSummary(revenue);
          setByDriver(breakdown);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load platform revenue.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  return (
    <AdminShell title="Earnings" subtitle="Platform revenue & per-driver breakdown" errorMessage={errorMessage}>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setRefreshCount((count) => count + 1)}
          disabled={isLoading}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERIODS.map(({ key, label }) => (
            <RevenueCard key={key} label={label} totals={summary[key]} />
          ))}
        </div>
      ) : (
        !isLoading && <p className="text-sm text-slate-500">No revenue data yet.</p>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-900">Per-driver breakdown (all-time)</h2>
      {byDriver.length === 0 ? (
        <p className="text-sm text-slate-500">No driver earnings recorded yet.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Rides</th>
              <th className="px-4 py-3">Gross fare</th>
              <th className="px-4 py-3">Platform commission</th>
              <th className="px-4 py-3">Driver earnings</th>
            </tr>
          </thead>
          <tbody>
            {byDriver.map((row) => (
              <tr key={row.driverId} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{row.driverName}</td>
                <td className="px-4 py-3 text-slate-600">{row.rideCount}</td>
                <td className="px-4 py-3 text-slate-600">{formatCents(row.grossFareCents)}</td>
                <td className="px-4 py-3 text-slate-600">{formatCents(row.platformCommissionCents)}</td>
                <td className="px-4 py-3 text-slate-600">{formatCents(row.driverGrossEarningsCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
