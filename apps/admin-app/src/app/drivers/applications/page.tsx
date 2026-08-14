'use client';

import type { AdminDriverSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, approveDriver, listAdminDrivers, rejectDriver } from '@/lib/apiClient';

/**
 * Section 14's "Driver Applications" — the same driver list as
 * /drivers, prefiltered to PENDING_REVIEW, with quick approve/reject
 * actions right in the row so an admin can clear the queue without
 * opening each driver's detail page. Not a separate backend concept —
 * see apps/api's GET /admin/drivers?onboardingStatus=PENDING_REVIEW.
 */
export default function DriverApplicationsPage() {
  const { accessToken } = useAdminAuth();
  const [drivers, setDrivers] = useState<AdminDriverSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  // Bumped after a successful approve/reject to trigger the fetch effect
  // below again — keeping the actual fetch call inline in the effect
  // (rather than an externally-referenced function) is what
  // react-hooks/set-state-in-effect wants here.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminDrivers(token, 'PENDING_REVIEW');
        if (!cancelled) setDrivers(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load driver applications.',
          );
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  async function handleApprove(driverId: string) {
    if (!accessToken) return;
    setBusyDriverId(driverId);
    setErrorMessage(null);
    try {
      await approveDriver(accessToken, driverId);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not approve this driver.');
    } finally {
      setBusyDriverId(null);
    }
  }

  async function handleReject(driverId: string) {
    if (!accessToken) return;
    const reason = (reasonById[driverId] ?? '').trim();
    if (!reason) {
      setErrorMessage('A rejection reason is required.');
      return;
    }
    setBusyDriverId(driverId);
    setErrorMessage(null);
    try {
      await rejectDriver(accessToken, driverId, reason);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not reject this driver.');
    } finally {
      setBusyDriverId(null);
    }
  }

  return (
    <AdminShell
      title="Driver Applications"
      subtitle={`${drivers.length} pending review`}
      errorMessage={errorMessage}
    >
      {drivers.length === 0 ? (
        <p className="text-sm text-slate-500">No applications awaiting review.</p>
      ) : (
        <div className="space-y-3">
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <Link href={`/drivers/${driver.id}`} className="font-medium text-slate-900 hover:underline">
                  {driver.firstName} {driver.lastName}
                </Link>
                <p className="text-sm text-slate-500">{driver.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyDriverId === driver.id}
                  onClick={() => void handleApprove(driver.id)}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <input
                  placeholder="Rejection reason"
                  value={reasonById[driver.id] ?? ''}
                  onChange={(event) =>
                    setReasonById((previous) => ({ ...previous, [driver.id]: event.target.value }))
                  }
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={busyDriverId === driver.id}
                  onClick={() => void handleReject(driver.id)}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
