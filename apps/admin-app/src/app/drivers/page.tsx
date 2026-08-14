'use client';

import type { AdminDriverSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminDrivers } from '@/lib/apiClient';

type StatusFilter = AdminDriverSummary['onboardingStatus'] | 'ALL';

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];

const STATUS_BADGE_STYLE: Record<AdminDriverSummary['onboardingStatus'], string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-red-100 text-red-700',
};

/** Section 14's "Drivers" — every driver regardless of onboarding
 * status, with a client-side filter dropdown over the same
 * ?onboardingStatus= the backend already exposes. The "Driver
 * Applications" nav item is a separate, prefiltered page rather than a
 * tab here — see /drivers/applications. */
export default function DriversPage() {
  const { accessToken } = useAdminAuth();
  const [drivers, setDrivers] = useState<AdminDriverSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, statusFilter: StatusFilter) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await listAdminDrivers(
          token,
          statusFilter === 'ALL' ? undefined : statusFilter,
        );
        if (!cancelled) setDrivers(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load drivers.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken, filter);
    return () => {
      cancelled = true;
    };
  }, [accessToken, filter]);

  return (
    <AdminShell title="Drivers" subtitle={`${drivers.length} driver(s)`} errorMessage={errorMessage}>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Status:</span>
        {STATUS_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === option ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {isLoading && drivers.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-slate-500">No drivers match this filter.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Onboarding</th>
              <th className="px-4 py-3">Availability</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Rides</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => (
              <tr key={driver.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/drivers/${driver.id}`} className="font-medium text-slate-900 hover:underline">
                    {driver.firstName} {driver.lastName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{driver.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_BADGE_STYLE[driver.onboardingStatus]}`}
                  >
                    {driver.onboardingStatus}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{driver.availabilityStatus}</td>
                <td className="px-4 py-3 text-slate-600">
                  {driver.averageRating !== null ? `★ ${driver.averageRating.toFixed(2)}` : '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{driver.totalRides}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
