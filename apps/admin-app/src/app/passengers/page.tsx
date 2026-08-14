'use client';

import type { AdminPassengerSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminPassengers } from '@/lib/apiClient';

/** Section 14's "Passengers" — every passenger account, newest first. */
export default function PassengersPage() {
  const { accessToken } = useAdminAuth();
  const [passengers, setPassengers] = useState<AdminPassengerSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      try {
        const result = await listAdminPassengers(token);
        if (!cancelled) setPassengers(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load passengers.',
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
  }, [accessToken]);

  return (
    <AdminShell title="Passengers" subtitle={`${passengers.length} account(s)`} errorMessage={errorMessage}>
      {isLoading && passengers.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : passengers.length === 0 ? (
        <p className="text-sm text-slate-500">No passengers yet.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {passengers.map((passenger) => (
              <tr key={passenger.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link
                    href={`/passengers/${passenger.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {passenger.firstName} {passenger.lastName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{passenger.email}</td>
                <td className="px-4 py-3 text-slate-600">
                  {passenger.averageRating !== null
                    ? `★ ${passenger.averageRating.toFixed(2)} (${passenger.ratingsCount})`
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      passenger.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {passenger.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(passenger.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
