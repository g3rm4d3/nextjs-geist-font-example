'use client';

import type { AdminSystemSetting } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminSettings, upsertAdminSetting } from '@/lib/apiClient';

/**
 * Section 14's "System Settings" — generic admin-editable key/value
 * platform settings. Viewing is any admin; writing is SUPER_ADMIN only
 * server-side (the form is hidden for a plain ADMIN). `value` is a
 * generic JSON column (packages/database's system_settings.value), so
 * this form takes it as raw JSON text and round-trips it through
 * JSON.parse before submitting.
 */
export default function SettingsPage() {
  const { accessToken, user } = useAdminAuth();
  const [settings, setSettings] = useState<AdminSystemSetting[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const [newKey, setNewKey] = useState('');
  const [newValueJson, setNewValueJson] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminSettings(token);
        if (!cancelled) setSettings(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load settings.');
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

    let value: unknown;
    try {
      value = newValueJson.trim().length > 0 ? JSON.parse(newValueJson) : null;
    } catch {
      setErrorMessage('Value must be valid JSON (e.g. true, 42, "text", {"a":1}).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await upsertAdminSetting(accessToken, newKey.trim(), {
        value,
        description: newDescription.trim() || undefined,
      });
      setNewKey('');
      setNewValueJson('');
      setNewDescription('');
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not save this setting.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AdminShell title="System Settings" subtitle={`${settings.length} key(s)`} errorMessage={errorMessage}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Current settings</h2>
          {settings.length === 0 ? (
            <p className="text-sm text-slate-500">No settings defined yet.</p>
          ) : (
            <div className="space-y-2">
              {settings.map((setting) => (
                <div key={setting.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <div className="font-medium text-slate-900">{setting.key}</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                    {JSON.stringify(setting.value, null, 2)}
                  </pre>
                  {setting.description && <p className="mt-1 text-xs text-slate-500">{setting.description}</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    Updated {new Date(setting.updatedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Set a value</h2>
          {!isSuperAdmin ? (
            <p className="text-sm text-slate-500">Writing settings requires SUPER_ADMIN.</p>
          ) : (
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <label className="block text-xs text-slate-500">Key</label>
                <input
                  required
                  value={newKey}
                  onChange={(event) => setNewKey(event.target.value)}
                  placeholder="e.g. surge_multiplier_cap"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Value (JSON)</label>
                <textarea
                  required
                  value={newValueJson}
                  onChange={(event) => setNewValueJson(event.target.value)}
                  placeholder='e.g. true or {"enabled":true}'
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Description (optional)</label>
                <input
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmitting ? 'Saving…' : 'Save setting'}
              </button>
            </form>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
