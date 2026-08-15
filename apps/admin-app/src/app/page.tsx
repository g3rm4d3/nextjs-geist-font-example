'use client';

import type { AdminDashboardSummary } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getAdminDashboard } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/**
 * Section 14's "Dashboard" — one-call summary of everything else this
 * app's sections would otherwise make an admin count by hand. Fetched
 * once on load with a manual refresh, same cadence as /revenue.
 */
export default function DashboardPage() {
  const { accessToken } = useAdminAuth();
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await getAdminDashboard(token);
        if (!cancelled) setSummary(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load the dashboard.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  return (
    <AdminShell title="Dashboard" subtitle="Stage 1 — Development build, not for commercial use" errorMessage={errorMessage}>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setRefreshCount((count) => count + 1)}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {!summary ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Passengers" value={summary.totalPassengers} />
          <StatCard label="Drivers" value={summary.totalDrivers} />
          <StatCard label="Pending driver applications" value={summary.pendingDriverApplications} />
          <StatCard label="Pending documents" value={summary.pendingDocuments} />
          <StatCard label="Documents expiring soon" value={summary.expiringDocumentsCount} />
          <StatCard label="Active rides" value={summary.activeRideCount} />
          <StatCard label="Open support tickets" value={summary.openSupportTicketCount} />
          <StatCard label="Rides today" value={summary.todayRideCount} />
          <StatCard label="Platform commission today" value={formatCents(summary.todayPlatformCommissionCents)} />
        </div>
      )}
    </AdminShell>
  );
}
