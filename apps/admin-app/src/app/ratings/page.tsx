'use client';

import type { AdminRatingSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminRatings } from '@/lib/apiClient';

/** Section 14's "Ratings" — every rating across every ride, both
 * directions, newest first. Read-only: no moderation flow yet (see
 * docs/ratings.md's own known limitations). */
export default function RatingsPage() {
  const { accessToken } = useAdminAuth();
  const [ratings, setRatings] = useState<AdminRatingSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminRatings(token);
        if (!cancelled) setRatings(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load ratings.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <AdminShell title="Ratings" subtitle={`${ratings.length} rating(s)`} errorMessage={errorMessage}>
      {ratings.length === 0 ? (
        <p className="text-sm text-slate-500">No ratings yet.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Direction</th>
              <th className="px-4 py-3">Rater</th>
              <th className="px-4 py-3">Ratee</th>
              <th className="px-4 py-3">Stars</th>
              <th className="px-4 py-3">Comment</th>
              <th className="px-4 py-3">Ride</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {ratings.map((rating) => (
              <tr key={rating.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">
                  {rating.direction === 'PASSENGER_TO_DRIVER' ? 'Passenger → Driver' : 'Driver → Passenger'}
                </td>
                <td className="px-4 py-3 text-slate-900">{rating.raterName}</td>
                <td className="px-4 py-3 text-slate-900">{rating.rateeName}</td>
                <td className="px-4 py-3 text-amber-600">{'★'.repeat(rating.stars)}</td>
                <td className="px-4 py-3 text-slate-600">{rating.comment ?? '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/rides/${rating.rideId}`} className="text-slate-600 hover:underline">
                    {rating.rideId.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(rating.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
