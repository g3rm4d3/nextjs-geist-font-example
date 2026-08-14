'use client';

import type { AdminPricingConfig } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, changePricing, listAdminPricingConfigs } from '@/lib/apiClient';
import { formatCents } from '@/lib/format';

interface FormState {
  name: string;
  baseFareCents: string;
  perMileRateCents: string;
  perMinuteRateCents: string;
  minimumFareCents: string;
  bookingFeeCents: string;
  cancellationFeeCents: string;
  platformCommissionPercentage: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  baseFareCents: '',
  perMileRateCents: '',
  perMinuteRateCents: '',
  minimumFareCents: '',
  bookingFeeCents: '',
  cancellationFeeCents: '',
  platformCommissionPercentage: '',
};

/**
 * Section 14's "Pricing" — full version history (view, any admin) plus
 * "change pricing" (SUPER_ADMIN only server-side; the form below is
 * hidden for a plain ADMIN as a convenience, matching every other
 * SUPER_ADMIN-gated action in this app). Submitting always creates a new
 * named config and makes it active — nothing here ever edits an existing
 * row's numbers in place, so pricing history stays intact.
 */
export default function PricingPage() {
  const { accessToken, user } = useAdminAuth();
  const [configs, setConfigs] = useState<AdminPricingConfig[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminPricingConfigs(token);
        if (!cancelled) setConfigs(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load pricing configs.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await changePricing(accessToken, {
        name: form.name,
        baseFareCents: Number(form.baseFareCents),
        perMileRateCents: Number(form.perMileRateCents),
        perMinuteRateCents: Number(form.perMinuteRateCents),
        minimumFareCents: Number(form.minimumFareCents),
        bookingFeeCents: Number(form.bookingFeeCents),
        cancellationFeeCents: Number(form.cancellationFeeCents),
        platformCommissionPercentage: Number(form.platformCommissionPercentage),
      });
      setForm(EMPTY_FORM);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not change pricing.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AdminShell title="Pricing" subtitle={`${configs.length} version(s)`} errorMessage={errorMessage}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Version history</h2>
          <div className="space-y-2">
            {configs.map((config) => (
              <div
                key={config.id}
                className={`rounded-lg border p-4 text-sm shadow-sm ${
                  config.active ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{config.name}</span>
                  {config.active && (
                    <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                      Active
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                  <div>Base fare: {formatCents(config.baseFareCents)}</div>
                  <div>Per mile: {formatCents(config.perMileRateCents)}</div>
                  <div>Per minute: {formatCents(config.perMinuteRateCents)}</div>
                  <div>Minimum fare: {formatCents(config.minimumFareCents)}</div>
                  <div>Booking fee: {formatCents(config.bookingFeeCents)}</div>
                  <div>Cancellation fee: {formatCents(config.cancellationFeeCents)}</div>
                  <div>Commission: {config.platformCommissionPercentage}%</div>
                  <div>Effective: {new Date(config.effectiveAt).toLocaleDateString()}</div>
                </dl>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Change pricing</h2>
          {!isSuperAdmin ? (
            <p className="text-sm text-slate-500">Changing pricing requires SUPER_ADMIN.</p>
          ) : (
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <label className="block text-xs text-slate-500">Config name</label>
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['baseFareCents', 'Base fare (cents)'],
                    ['perMileRateCents', 'Per mile (cents)'],
                    ['perMinuteRateCents', 'Per minute (cents)'],
                    ['minimumFareCents', 'Minimum fare (cents)'],
                    ['bookingFeeCents', 'Booking fee (cents)'],
                    ['cancellationFeeCents', 'Cancellation fee (cents)'],
                  ] as [keyof FormState, string][]
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500">{label}</label>
                    <input
                      required
                      type="number"
                      min={0}
                      value={form[key]}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs text-slate-500">Platform commission (%)</label>
                <input
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.platformCommissionPercentage}
                  onChange={(event) =>
                    setForm({ ...form, platformCommissionPercentage: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmitting ? 'Saving…' : 'Activate new pricing config'}
              </button>
            </form>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
