'use client';

import type { AdminPaymentSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminPayments } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

type StatusFilter = AdminPaymentSummary['status'] | 'ALL';

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'];

const STATUS_BADGE_STYLE: Record<AdminPaymentSummary['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  SUCCEEDED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-slate-100 text-slate-600',
};

/** Section 14's "Payments" — every payment attempt across every ride.
 * Always Stripe TEST MODE money (section 1/11), never real revenue. */
export default function PaymentsPage() {
  const { accessToken } = useAdminAuth();
  const [payments, setPayments] = useState<AdminPaymentSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, statusFilter: StatusFilter) {
      try {
        const result = await listAdminPayments(
          token,
          statusFilter === 'ALL' ? undefined : statusFilter,
        );
        if (!cancelled) setPayments(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load payments.',
          );
        }
      }
    }

    void load(accessToken, filter);
    return () => {
      cancelled = true;
    };
  }, [accessToken, filter]);

  return (
    <AdminShell
      title="Payments"
      subtitle={`${payments.length} payment(s)`}
      errorMessage={errorMessage}
    >
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Status:</span>
        {STATUS_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === option
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-slate-500">No payments match this filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Ride</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/payments/${payment.id}`} className="hover:underline">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_BADGE_STYLE[payment.status]}`}
                      >
                        {payment.status}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{payment.passengerName}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatCents(payment.amountCents)} {payment.currency.toUpperCase()}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/rides/${payment.rideId}`}
                      className="text-slate-600 hover:underline"
                    >
                      {payment.rideId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(payment.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
