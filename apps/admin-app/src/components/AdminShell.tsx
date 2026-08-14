'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';

interface NavItem {
  href: string;
  label: string;
  /** Hidden entirely for a plain ADMIN — not just disabled. Reserved for
   * sections a plain ADMIN can't even read (audit logs); sections a
   * plain ADMIN can view but not mutate (pricing, settings) stay visible
   * and gate the write action inside the page itself. */
  superAdminOnly?: boolean;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

/** Phase 14's full section list (spec section 14), grouped for the
 * sidebar. Order follows the spec's own listing. */
const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/live-map', label: 'Live Operations (Fleet Map)' },
      { href: '/rides', label: 'Active Rides' },
    ],
  },
  {
    heading: 'People',
    items: [
      { href: '/passengers', label: 'Passengers' },
      { href: '/drivers', label: 'Drivers' },
      { href: '/drivers/applications', label: 'Driver Applications' },
      { href: '/vehicles', label: 'Vehicles' },
      { href: '/documents', label: 'Documents' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/rides/all', label: 'Rides' },
      { href: '/payments', label: 'Payments' },
      { href: '/revenue', label: 'Earnings' },
      { href: '/ratings', label: 'Ratings' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/settings', label: 'System Settings' },
      { href: '/audit-logs', label: 'Audit Logs', superAdminOnly: true },
    ],
  },
];

interface AdminShellProps {
  title: string;
  subtitle?: string;
  errorMessage?: string | null;
  children: ReactNode;
}

/**
 * Shared chrome for every signed-in admin-app page (Phase 14): sidebar
 * nav (with SUPER_ADMIN-only sections hidden for a plain ADMIN — a
 * client-side convenience only, never the actual security boundary; the
 * API's own requireRole is what actually enforces this), a top bar with
 * the signed-in admin's identity/role and logout, and the standard
 * signed-out redirect + loading state every page up to this phase
 * duplicated by hand.
 */
export function AdminShell({ title, subtitle, errorMessage, children }: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, logout } = useAdminAuth();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  if (status !== 'signedIn') {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">Loading…</main>
    );
  }

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // The single most-specific nav href matching the current path (e.g.
  // /rides/all must win over /rides for pathname "/rides/all/123" —
  // plain prefix-matching per item would light up both at once since
  // "/rides/all".startsWith("/rides")).
  const allHrefs = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
  const matchingHrefs = allHrefs.filter(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
  const activeHref = matchingHrefs.sort((a, b) => b.length - a.length)[0];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Stage 1 — Dev build
          </p>
          <p className="mt-1 font-semibold text-slate-900">Rideshare Admin</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4 text-sm">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.heading}
              </p>
              <ul className="mt-1 space-y-0.5">
                {section.items
                  .filter((item) => !item.superAdminOnly || isSuperAdmin)
                  .map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-md px-2 py-1.5 ${
                            active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{user?.email}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {user?.role}
            </span>
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
          <p className="bg-red-50 px-6 py-2 text-sm text-red-600" data-testid="admin-shell-error">
            {errorMessage}
          </p>
        )}

        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}
