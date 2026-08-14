'use client';

import type { AdminRideSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminRides } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

type StatusFilter = AdminRideSummary['status'] | 'ALL';

const STATUS_FILTERS: StatusFilter[] = [
  'ALL',
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'PASSENGER_ONBOARD',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
];

const STATUS_BADGE_STYLE: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED_BY_PASSENGER: 'bg-red-100 text-red-700',
  CANCELLED_BY_DRIVER: 'bg-red-100 text-red-700',
  CANCELLED_BY_SYSTEM: 'bg-red-100 text-red-700',
};

/**
 * Section 14's "Rides" — every ride ever requested, regardless of
 * status, most recent first. Distinct from Phase 10's /rides (that page
 * stays as-is: non-terminal rides only, for live operations); this is
 * the full browsable history a plain "Rides" nav item implies.
 */
export default function AllRidesPage() {
  const { accessToken } = useAdminAuth();
  const [rides, setRides] = useState<AdminRideSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, statusFilter: StatusFilter) {
      try {
        const result = await listAdminRides(token, statusFilter === 'ALL' ? undefined : statusFilter);
        if (!cancelled) setRides(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load rides.');
        }
      }
    }

    void load(accessToken, filter);
    return () => {
      cancelled = true;
    };
  }, [accessToken, filter]);

  return (
    <AdminShell title="Rides" subtitle={`${rides.length} ride(s)`} errorMessage={errorMessage}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
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

      {rides.length === 0 ? (
        <p className="text-sm text-slate-500">No rides match this filter.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Passenger</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Fare</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Completed</th>
            </tr>
          </thead>
          <tbody>
            {rides.map((ride) => (
              <tr key={ride.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/rides/${ride.id}`} className="hover:underline">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        STATUS_BADGE_STYLE[ride.status] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {ride.status}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-900">{ride.passengerName}</td>
                <td className="px-4 py-3 text-slate-900">{ride.driverName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">
                  {ride.finalFareCents !== null ? formatCents(ride.finalFareCents) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(ride.requestedAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-500">
                  {ride.completedAt ? new Date(ride.completedAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
