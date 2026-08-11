import Link from 'next/link';
import { SystemStatusCard } from '@/components/SystemStatusCard';

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
          Stage 1 — Development build, not for commercial use
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Rideshare Admin</h1>
        <p className="mt-1 text-slate-600">
          Internal console for platform operations. Foundation scaffold — sections listed in the
          engineering spec (drivers, rides, payments, support, …) are built out in later phases.
        </p>
      </header>

      <SystemStatusCard />

      <Link
        href="/live-map"
        className="mt-6 block rounded-lg border border-slate-200 bg-white px-6 py-4 text-slate-900 shadow-sm hover:bg-slate-50"
      >
        <span className="text-sm font-medium text-slate-500">Phase 6</span>
        <p className="mt-1 font-semibold">Live fleet map →</p>
        <p className="mt-1 text-sm text-slate-600">
          Watch virtual drivers move in real time. Requires an admin login.
        </p>
      </Link>

      <Link
        href="/rides"
        className="mt-4 block rounded-lg border border-slate-200 bg-white px-6 py-4 text-slate-900 shadow-sm hover:bg-slate-50"
      >
        <span className="text-sm font-medium text-slate-500">Phase 10</span>
        <p className="mt-1 font-semibold">Active rides →</p>
        <p className="mt-1 text-sm text-slate-600">
          Every ride currently in progress — status, passenger, driver, vehicle. Requires an admin
          login.
        </p>
      </Link>

      <Link
        href="/revenue"
        className="mt-4 block rounded-lg border border-slate-200 bg-white px-6 py-4 text-slate-900 shadow-sm hover:bg-slate-50"
      >
        <span className="text-sm font-medium text-slate-500">Phase 12</span>
        <p className="mt-1 font-semibold">Platform revenue →</p>
        <p className="mt-1 text-sm text-slate-600">
          Today/week/month/all-time platform commission from Stripe TEST MODE test rides. Requires
          an admin login.
        </p>
      </Link>
    </main>
  );
}
