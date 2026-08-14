'use client';

import type { AdminSupportTicketSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, listAdminSupportTickets } from '@/lib/apiClient';

const STATUS_BADGE_STYLE: Record<AdminSupportTicketSummary['status'], string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAITING_USER: 'bg-purple-100 text-purple-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

/**
 * Section 14's "Support" ticket list. The passenger/driver-facing side
 * that actually opens a ticket is a later phase (section 18) — nothing
 * writes to support_tickets yet, so this is a real, functional read
 * over whatever rows exist (currently none in a fresh environment).
 */
export default function SupportTicketsPage() {
  const { accessToken } = useAdminAuth();
  const [tickets, setTickets] = useState<AdminSupportTicketSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await listAdminSupportTickets(token);
        if (!cancelled) setTickets(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load support tickets.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <AdminShell title="Support" subtitle={`${tickets.length} ticket(s)`} errorMessage={errorMessage}>
      {tickets.length === 0 ? (
        <p className="text-sm text-slate-500">No support tickets yet.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ride</th>
              <th className="px-4 py-3">Opened</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link href={`/support/${ticket.id}`} className="font-medium text-slate-900 hover:underline">
                    {ticket.subject}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{ticket.userName}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_BADGE_STYLE[ticket.status]}`}>
                    {ticket.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {ticket.rideId ? (
                    <Link href={`/rides/${ticket.rideId}`} className="hover:underline">
                      {ticket.rideId.slice(0, 8)}…
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(ticket.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}
