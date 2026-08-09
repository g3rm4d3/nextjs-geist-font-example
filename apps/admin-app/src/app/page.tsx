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
    </main>
  );
}
