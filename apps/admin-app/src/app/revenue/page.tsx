'use client';

import type { EarningsPeriodTotals, PlatformRevenueSummary } from '@rideshare/types';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getPlatformRevenue } from '@/lib/apiClient';
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
 * Section 12: "Admin sees platform test revenue." Platform-wide
 * equivalent of the driver-app's EarningsScreen (GET /admin/revenue,
 * the same today/week/month windows plus an all-time total). Fetched
 * once on load with a manual refresh — unlike the fleet map/active
 * rides pages, revenue has no reason to be watched second-by-second.
 * Every figure here is Stripe TEST MODE money from fictional test
 * rides — never real revenue (section 1/11).
 */
export default function RevenuePage() {
  const router = useRouter();
  const { status, accessToken, user, logout } = useAdminAuth();
  const [summary, setSummary] = useState<PlatformRevenueSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (!accessToken) return undefined;

    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getPlatformRevenue(token);
        if (!cancelled) setSummary(result);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load platform revenue.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken);

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // A separate handler (not the effect above) for the manual "Refresh"
  // button — same split apps/passenger-app's RideCompleteScreen uses
  // between its load-on-mount effect and its click-triggered retry
  // handler, to satisfy the same react-hooks/set-state-in-effect rule.
  const handleRefresh = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await getPlatformRevenue(accessToken);
      setSummary(result);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not load platform revenue.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  if (status !== 'signedIn') {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Stage 1 — Development build
          </p>
          <h1 className="text-lg font-semibold text-slate-900">Platform revenue</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isLoading}
            className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="refresh-button"
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span>{user?.email}</span>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50"
            data-testid="logout-button"
          >
            Log out
          </button>
        </div>
      </header>

      {errorMessage && (
        <p className="bg-red-50 px-6 py-2 text-sm text-red-600" data-testid="revenue-error">
          {errorMessage}
        </p>
      )}

      <div className="flex-1 overflow-auto p-6">
        {summary ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PERIODS.map(({ key, label }) => (
              <RevenueCard key={key} label={label} totals={summary[key]} />
            ))}
          </div>
        ) : (
          !isLoading && <p className="text-sm text-slate-500">No revenue data yet.</p>
        )}
      </div>
    </main>
  );
}
