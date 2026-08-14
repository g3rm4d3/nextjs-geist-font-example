'use client';

import type { AdminSupportTicketDetail } from '@rideshare/types';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError, getAdminSupportTicket } from '@/lib/apiClient';

/** "Inspect" a support ticket — the full message thread, oldest first,
 * including admin-only internal notes. */
export default function SupportTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken } = useAdminAuth();
  const [ticket, setTicket] = useState<AdminSupportTicketDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, ticketId: string) {
      try {
        const result = await getAdminSupportTicket(token, ticketId);
        if (!cancelled) setTicket(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load this ticket.');
        }
      }
    }

    void load(accessToken, params.id);
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.id]);

  return (
    <AdminShell title={ticket?.subject ?? 'Support ticket'} subtitle={ticket?.status} errorMessage={errorMessage}>
      {!ticket ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="max-w-2xl space-y-3">
          <p className="text-sm text-slate-500">
            From {ticket.userName} · opened {new Date(ticket.createdAt).toLocaleString()}
          </p>

          {ticket.messages.length === 0 ? (
            <p className="text-sm text-slate-500">No messages on this ticket yet.</p>
          ) : (
            ticket.messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border p-4 shadow-sm ${
                  message.isInternalNote ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{message.authorName ?? 'System'}</span>
                  <span>{new Date(message.createdAt).toLocaleString()}</span>
                </div>
                {message.isInternalNote && (
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Internal note
                  </p>
                )}
                <p className="text-sm text-slate-900">{message.body}</p>
              </div>
            ))
          )}
        </div>
      )}
    </AdminShell>
  );
}
