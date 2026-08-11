'use client';

import type { AdminActiveRide } from '@rideshare/types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getActiveRides } from '@/lib/apiClient';

const POLL_INTERVAL_MS = 4000;

/** Section 12's lifecycle states this page ever shows — every non-
 * terminal one, same set rideLifecycleService/ridesRepository call
 * ACTIVE_RIDE_STATUSES server-side. */
const STATUS_BADGE_STYLE: Record<string, string> = {
  REQUESTED: 'bg-slate-100 text-slate-700',
  SEARCHING_DRIVER: 'bg-amber-100 text-amber-700',
  DRIVER_ASSIGNED: 'bg-blue-100 text-blue-700',
  DRIVER_EN_ROUTE: 'bg-blue-100 text-blue-700',
  DRIVER_ARRIVED: 'bg-indigo-100 text-indigo-700',
  PASSENGER_ONBOARD: 'bg-purple-100 text-purple-700',
  IN_PROGRESS: 'bg-green-100 text-green-700',
};

/**
 * Section 10: "Admin: show active rides." Polls GET /admin/rides/active
 * on the same interval as the live fleet map (Phase 6) rather than
 * anything push-based — Stage 1 still has no realtime transport. A
 * table, not a map: unlike the fleet map's whole point (watching
 * position on a map), "which rides are active and what stage is each
 * one at" is a list-shaped question — driver *location* for a specific
 * ride already has its own dedicated view server-side
 * (GET /rides/:id/driver, apps/passenger-app's tracking screens).
 */
export default function ActiveRidesPage() {
  const router = useRouter();
  const { status, accessToken, user, logout } = useAdminAuth();
  const [rides, setRides] = useState<AdminActiveRide[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    async function poll(token: string) {
      try {
        const result = await getActiveRides(token);
        if (cancelled) return;
        setRides(result);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load active rides.',
        );
      }
    }

    void poll(accessToken);
    const interval = setInterval(() => void poll(accessToken), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
          <h1 className="text-lg font-semibold text-slate-900">Active rides</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span data-testid="active-rides-summary">
            {rides.length} active ride{rides.length === 1 ? '' : 's'}
          </span>
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
        <p className="bg-red-50 px-6 py-2 text-sm text-red-600" data-testid="active-rides-error">
          {errorMessage}
        </p>
      )}

      <div className="flex-1 overflow-auto p-6">
        {rides.length === 0 ? (
          <p className="text-sm text-slate-500">No active rides right now.</p>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Pickup</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Requested</th>
              </tr>
            </thead>
            <tbody>
              {rides.map((ride) => (
                <tr key={ride.id} className="border-t border-slate-100" data-testid="active-ride-row">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        STATUS_BADGE_STYLE[ride.status] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {ride.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{ride.passengerName}</td>
                  <td className="px-4 py-3 text-slate-900">{ride.driverName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {ride.vehicle
                      ? `${ride.vehicle.color} ${ride.vehicle.make} ${ride.vehicle.model} · ${ride.vehicle.licensePlate}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ride.pickup.label}</td>
                  <td className="px-4 py-3 text-slate-600">{ride.destination.label}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(ride.requestedAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
