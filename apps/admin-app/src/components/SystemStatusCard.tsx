'use client';

import { useEffect, useState } from 'react';
import { fetchApiHealth } from '@/lib/apiClient';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; apiConnected: true; databaseConnected: boolean };

export function SystemStatusCard() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetchApiHealth()
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setStatus({ kind: 'error', message: response.error.message });
          return;
        }
        setStatus({
          kind: 'ok',
          apiConnected: true,
          databaseConnected: response.data.database.connected,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: 'Could not reach the API' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-medium text-slate-500">Platform status</h2>

      {status.kind === 'loading' && (
        <p className="mt-2 text-slate-600" data-testid="status-loading">
          Checking API connectivity…
        </p>
      )}

      {status.kind === 'error' && (
        <p className="mt-2 text-red-600" data-testid="status-error">
          API unreachable: {status.message}
        </p>
      )}

      {status.kind === 'ok' && (
        <dl className="mt-2 space-y-1" data-testid="status-ok">
          <div className="flex items-center gap-2">
            <StatusDot ok={status.apiConnected} />
            <dt className="text-slate-700">API</dt>
            <dd className="text-slate-500">{status.apiConnected ? 'online' : 'offline'}</dd>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot ok={status.databaseConnected} />
            <dt className="text-slate-700">Database</dt>
            <dd className="text-slate-500">
              {status.databaseConnected ? 'connected' : 'disconnected'}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`}
      aria-hidden="true"
    />
  );
}
