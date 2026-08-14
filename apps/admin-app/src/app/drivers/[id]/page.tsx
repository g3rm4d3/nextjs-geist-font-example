'use client';

import type { AdminDriverDetail } from '@rideshare/types';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import {
  ApiClientError,
  approveDriver,
  getAdminDriver,
  reactivateDriver,
  rejectDriver,
  suspendDriver,
} from '@/lib/apiClient';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * "Inspect driver" plus the four admin-triggered moderation actions
 * (section 14: approve/reject/suspend/reactivate driver). Approve/reject
 * are available to any admin; suspend/reactivate are SUPER_ADMIN-only —
 * the buttons are hidden for a plain ADMIN as a UI convenience, but the
 * actual boundary is the API's own requireRole('SUPER_ADMIN').
 */
export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken, user } = useAdminAuth();
  const [driver, setDriver] = useState<AdminDriverDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  // Bumped after a successful moderation action to re-trigger the fetch
  // effect below — see drivers/applications/page.tsx's identical comment.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, driverId: string) {
      try {
        const result = await getAdminDriver(token, driverId);
        if (!cancelled) setDriver(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load this driver.');
        }
      }
    }

    void load(accessToken, params.id);
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id, refreshCount]);

  async function runAction(action: () => Promise<unknown>) {
    if (!accessToken) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await action();
      setRefreshCount((count) => count + 1);
      setRejectReason('');
      setSuspendReason('');
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'That action failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <AdminShell
      title={driver ? `${driver.firstName} ${driver.lastName}` : 'Driver'}
      subtitle="Driver detail"
      errorMessage={errorMessage}
    >
      {!driver ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Profile</h2>
            <dl>
              <Field label="Email" value={driver.email} />
              <Field label="Onboarding" value={driver.onboardingStatus} />
              <Field label="Availability" value={driver.availabilityStatus} />
              <Field label="License #" value={driver.licenseNumber} />
              <Field label="License state" value={driver.licenseState} />
              <Field
                label="License expires"
                value={driver.licenseExpiresAt ? new Date(driver.licenseExpiresAt).toLocaleDateString() : '—'}
              />
              <Field
                label="Rating"
                value={
                  driver.averageRating !== null
                    ? `★ ${driver.averageRating.toFixed(2)} (${driver.ratingsCount})`
                    : 'No ratings yet'
                }
              />
              <Field label="Total rides" value={driver.totalRides} />
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Vehicle</h2>
            {driver.vehicle ? (
              <dl>
                <Field label="Make/model" value={`${driver.vehicle.make} ${driver.vehicle.model}`} />
                <Field label="Year" value={driver.vehicle.year} />
                <Field label="Color" value={driver.vehicle.color} />
                <Field label="Plate" value={driver.vehicle.licensePlate} />
                <Field label="Seats" value={driver.vehicle.seats} />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No vehicle on file.</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Documents</h2>
            {driver.documents.length === 0 ? (
              <p className="text-sm text-slate-500">No documents uploaded.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1">Type</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {driver.documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-100">
                      <td className="py-2">{doc.documentType}</td>
                      <td className="py-2">{doc.reviewStatus}</td>
                      <td className="py-2 text-slate-500">{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Moderation actions</h2>
            <div className="flex flex-wrap items-start gap-4">
              {driver.onboardingStatus === 'PENDING_REVIEW' && (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      void runAction(() => approveDriver(accessToken as string, driver.id))
                    }
                    className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">Rejection reason</label>
                      <input
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isSubmitting || rejectReason.trim().length === 0}
                      onClick={() =>
                        void runAction(() =>
                          rejectDriver(accessToken as string, driver.id, rejectReason.trim()),
                        )
                      }
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}

              {driver.onboardingStatus === 'APPROVED' &&
                (isSuperAdmin ? (
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">Suspension reason</label>
                      <input
                        value={suspendReason}
                        onChange={(event) => setSuspendReason(event.target.value)}
                        className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isSubmitting || suspendReason.trim().length === 0}
                      onClick={() =>
                        void runAction(() =>
                          suspendDriver(accessToken as string, driver.id, suspendReason.trim()),
                        )
                      }
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Suspend (SUPER_ADMIN)
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Suspending a driver requires SUPER_ADMIN.</p>
                ))}

              {driver.onboardingStatus === 'SUSPENDED' &&
                (isSuperAdmin ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      void runAction(() => reactivateDriver(accessToken as string, driver.id))
                    }
                    className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Reactivate (SUPER_ADMIN)
                  </button>
                ) : (
                  <p className="text-sm text-slate-500">Reactivating a driver requires SUPER_ADMIN.</p>
                ))}

              {(driver.onboardingStatus === 'DRAFT' || driver.onboardingStatus === 'REJECTED') && (
                <p className="text-sm text-slate-500">
                  No moderation action available from onboarding status {driver.onboardingStatus}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
