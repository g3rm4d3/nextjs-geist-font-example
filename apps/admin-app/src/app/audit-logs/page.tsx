'use client';

import type { AdminAuditLogEntry } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminAuditLogs } from '@/lib/apiClient';

/**
 * Section 14's "Audit Logs" — SUPER_ADMIN only, server-side (this page
 * is also hidden from the nav for a plain ADMIN, but a direct visit
 * still just surfaces the API's 403 rather than any client-trusted
 * gate). Append-only; `before`/`after` are opaque JSON snapshots whose
 * shape depends on `entityType`, rendered as raw JSON here rather than
 * per-type formatting.
 */
export default function AuditLogsPage() {
  const { accessToken, user } = useAdminAuth();
  const [entries, setEntries] = useState<AdminAuditLogEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminAuditLogs(token);
        if (!cancelled) setEntries(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load audit logs.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <AdminShell title="Audit Logs" subtitle={`${entries.length} entr(y/ies)`} errorMessage={errorMessage}>
      {user?.role !== 'SUPER_ADMIN' ? (
        <p className="text-sm text-slate-500">Viewing the audit trail requires SUPER_ADMIN.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">No audit records yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{entry.action}</span>
                <span className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {entry.entityType} {entry.entityId ? `· ${entry.entityId}` : ''} · actor {entry.actorUserId ?? '—'}{' '}
                ({entry.actorRole ?? '—'})
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="font-semibold text-slate-500">Before</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-slate-700">
                    {JSON.stringify(entry.before, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="font-semibold text-slate-500">After</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-slate-700">
                    {JSON.stringify(entry.after, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
