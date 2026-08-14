'use client';

import type { FleetDriverLocation } from '@rideshare/types';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getFleetLocations } from '@/lib/apiClient';

// Leaflet touches `window` at import time, which breaks server rendering —
// ssr:false defers it to the client entirely. This is only legal inside a
// Client Component in the app router, which is why this whole page is one.
const FleetMap = dynamic(() => import('@/components/FleetMap').then((mod) => mod.FleetMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-slate-500">Loading map…</div>
  ),
});

const POLL_INTERVAL_MS = 4000;

/**
 * Phase 6's live fleet map. Polls GET /admin/drivers/locations on an
 * interval rather than anything push-based — Stage 1 has no realtime
 * transport yet (that's Phase 10); a poll every few seconds is more than
 * enough to watch apps/api/scripts/locationSimulator.ts's virtual
 * drivers move.
 */
export default function LiveMapPage() {
  const router = useRouter();
  const { status, accessToken, user, logout } = useAdminAuth();
  const [locations, setLocations] = useState<FleetDriverLocation[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    async function poll(token: string) {
      try {
        const result = await getFleetLocations(token);
        if (cancelled) return;
        setLocations(result);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load fleet locations.',
        );
      }
    }

    void poll(accessToken);
    const interval = setInterval(() => void poll(accessToken), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accessToken]);

  if (status !== 'signedIn') {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </main>
    );
  }

  const onlineCount = locations.filter((entry) => entry.availabilityStatus === 'ONLINE').length;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <Link href="/" className="text-xs font-medium text-slate-500 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Live fleet map</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span data-testid="fleet-summary">
            {locations.length} driver{locations.length === 1 ? '' : 's'} · {onlineCount} online
          </span>
          <span>{user?.email}</span>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50"
            data-testid="logout-button"
          >
            Log out
          </button>
        </div>
      </header>

      {errorMessage && (
        <p className="bg-red-50 px-6 py-2 text-sm text-red-600" data-testid="fleet-error">
          {errorMessage}
        </p>
      )}

      <div className="flex-1">
        <FleetMap locations={locations} />
      </div>
    </main>
  );
}
