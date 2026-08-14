'use client';

import type { AdminPassengerDetail } from '@rideshare/types';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getAdminPassenger } from '@/lib/apiClient';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/** "Inspect passenger." */
export default function PassengerDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken } = useAdminAuth();
  const [passenger, setPassenger] = useState<AdminPassengerDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await getAdminPassenger(token, params.id);
        if (!cancelled) setPassenger(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load this passenger.',
          );
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id]);

  return (
    <AdminShell
      title={passenger ? `${passenger.firstName} ${passenger.lastName}` : 'Passenger'}
      subtitle="Passenger detail"
      errorMessage={errorMessage}
    >
      {!passenger ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <dl>
            <Field label="Email" value={passenger.email} />
            <Field
              label="Status"
              value={
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    passenger.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {passenger.isActive ? 'Active' : 'Inactive'}
                </span>
              }
            />
            <Field
              label="Rating"
              value={
                passenger.averageRating !== null
                  ? `★ ${passenger.averageRating.toFixed(2)} (${passenger.ratingsCount} rating${
                      passenger.ratingsCount === 1 ? '' : 's'
                    })`
                  : 'No ratings yet'
              }
            />
            <Field label="Total rides" value={passenger.totalRides} />
            <Field
              label="Default test payment method"
              value={passenger.defaultTestPaymentMethodId ?? 'None on file'}
            />
            <Field label="Joined" value={new Date(passenger.createdAt).toLocaleString()} />
          </dl>
        </div>
      )}
    </AdminShell>
  );
}
