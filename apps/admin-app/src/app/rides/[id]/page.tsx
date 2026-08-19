'use client';

import type { AdminRideDetail } from '@rideshare/types';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getAdminRide } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/** "Inspect ride." */
export default function RideDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken } = useAdminAuth();
  const [ride, setRide] = useState<AdminRideDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, rideId: string) {
      try {
        const result = await getAdminRide(token, rideId);
        if (!cancelled) setRide(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load this ride.');
        }
      }
    }

    void load(accessToken, params.id);
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id]);

  return (
    <AdminShell title="Ride" subtitle={ride?.id} errorMessage={errorMessage}>
      {!ride ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Overview</h2>
            <dl>
              <Field label="Status" value={ride.status} />
              <Field label="Passenger" value={ride.passengerName} />
              <Field label="Driver" value={ride.driverName ?? '—'} />
              <Field label="Requested" value={new Date(ride.requestedAt).toLocaleString()} />
              <Field
                label="Completed"
                value={ride.completedAt ? new Date(ride.completedAt).toLocaleString() : '—'}
              />
              <Field
                label="Cancelled"
                value={ride.cancelledAt ? new Date(ride.cancelledAt).toLocaleString() : '—'}
              />
              {ride.cancelledBy && <Field label="Cancelled by" value={ride.cancelledBy} />}
              {ride.cancellationReason && <Field label="Cancellation reason" value={ride.cancellationReason} />}
              {ride.cancellationFeeCents !== null && (
                <Field label="Cancellation fee" value={formatCents(ride.cancellationFeeCents)} />
              )}
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Route &amp; fare</h2>
            <dl>
              <Field label="Pickup" value={ride.pickup.label} />
              <Field label="Destination" value={ride.destination.label} />
              <Field
                label="Estimated fare"
                value={ride.estimatedFareCents !== null ? formatCents(ride.estimatedFareCents) : '—'}
              />
              <Field
                label="Final fare"
                value={ride.finalFareCents !== null ? formatCents(ride.finalFareCents) : '—'}
              />
              <Field
                label="Distance"
                value={
                  ride.actualDistanceMeters !== null
                    ? `${(ride.actualDistanceMeters / 1609.34).toFixed(2)} mi`
                    : '—'
                }
              />
              <Field
                label="Duration"
                value={
                  ride.actualDurationSeconds !== null
                    ? `${Math.round(ride.actualDurationSeconds / 60)} min`
                    : '—'
                }
              />
            </dl>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
