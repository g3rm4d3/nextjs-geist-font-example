'use client';

import type { AdminPaymentDetail } from '@rideshare/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getAdminPayment } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/** "Inspect payment." Provider-safe only — no raw card data anywhere in
 * this codebase (section 11), so there is nothing sensitive to redact
 * here beyond what the API already omits. */
export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken } = useAdminAuth();
  const [payment, setPayment] = useState<AdminPaymentDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, paymentId: string) {
      try {
        const result = await getAdminPayment(token, paymentId);
        if (!cancelled) setPayment(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load this payment.');
        }
      }
    }

    void load(accessToken, params.id);
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id]);

  return (
    <AdminShell title="Payment" subtitle={payment?.id} errorMessage={errorMessage}>
      {!payment ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <dl>
            <Field label="Status" value={payment.status} />
            <Field label="Amount" value={`${formatCents(payment.amountCents)} ${payment.currency.toUpperCase()}`} />
            <Field label="Passenger" value={payment.passengerName} />
            <Field
              label="Ride"
              value={
                <Link href={`/rides/${payment.rideId}`} className="hover:underline">
                  {payment.rideId}
                </Link>
              }
            />
            <Field label="Provider payment intent" value={payment.providerPaymentIntentId ?? '—'} />
            <Field label="Failure reason" value={payment.failureReason ?? '—'} />
            <Field
              label="Refunded"
              value={payment.refundedAt ? new Date(payment.refundedAt).toLocaleString() : '—'}
            />
            <Field label="Refund reason" value={payment.refundReason ?? '—'} />
            <Field label="Created" value={new Date(payment.createdAt).toLocaleString()} />
          </dl>
        </div>
      )}
    </AdminShell>
  );
}
