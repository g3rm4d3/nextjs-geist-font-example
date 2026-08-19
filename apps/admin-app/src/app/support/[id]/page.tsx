'use client';

import type { AdminSupportTicketDetail, AdminSupportTicketStatus } from '@rideshare/types';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import {
  ApiClientError,
  changeSupportTicketStatus,
  getAdminSupportTicket,
  replySupportTicket,
} from '@/lib/apiClient';

const STATUS_OPTIONS: AdminSupportTicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
];

/** "Inspect" a support ticket — the full message thread, oldest first,
 * including admin-only internal notes — plus Phase 16's reply form (the
 * only writer of support_messages in Stage 1; see apps/api's
 * adminSupportService.replyToTicket for why this isn't a full Section
 * 18 ticket lifecycle). A non-internal-note reply is what fires the
 * "support update" notification to the ticket's owner. Section 18 adds
 * the status control below the header: any state can move to any other
 * (see apps/api's supportRepository.updateTicketStatus for why there's
 * no fixed transition graph), and a change fires that same "support
 * update" notification. */
export default function SupportTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const { accessToken } = useAdminAuth();
  const [ticket, setTicket] = useState<AdminSupportTicketDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  // Bumped after a successful reply to re-trigger the fetch effect below
  // — the actual fetch call stays inline in the effect (rather than
  // referencing an externally-defined function), same
  // react-hooks/set-state-in-effect workaround the documents page uses
  // for its own reload-after-write.
  const [refreshCount, setRefreshCount] = useState(0);

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
  }, [accessToken, params.id, refreshCount]);

  async function handleStatusChange(status: AdminSupportTicketStatus) {
    if (!accessToken || status === ticket?.status) return;
    setIsChangingStatus(true);
    setErrorMessage(null);
    try {
      await changeSupportTicketStatus(accessToken, params.id, status);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not change the status.');
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleReply() {
    if (!accessToken) return;
    const body = replyBody.trim();
    if (!body) {
      setErrorMessage('A reply body is required.');
      return;
    }

    setIsSending(true);
    setErrorMessage(null);
    try {
      await replySupportTicket(accessToken, params.id, { body, isInternalNote });
      setReplyBody('');
      setIsInternalNote(false);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not send the reply.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AdminShell title={ticket?.subject ?? 'Support ticket'} subtitle={ticket?.status} errorMessage={errorMessage}>
      {!ticket ? (
        <p className="text-sm text-slate-500">{errorMessage ? '' : 'Loading…'}</p>
      ) : (
        <div className="max-w-2xl space-y-3">
          <p className="text-sm text-slate-500">
            From {ticket.userName} · opened {new Date(ticket.createdAt).toLocaleString()}
          </p>

          <div className="flex items-center gap-2">
            <label htmlFor="ticket-status" className="text-xs font-semibold text-slate-600">
              Status
            </label>
            <select
              id="ticket-status"
              className="rounded border border-slate-300 p-1.5 text-sm disabled:opacity-50"
              value={ticket.status}
              disabled={isChangingStatus}
              onChange={(event) => void handleStatusChange(event.target.value as AdminSupportTicketStatus)}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

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

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label htmlFor="reply-body" className="mb-1 block text-xs font-semibold text-slate-600">
              Reply
            </label>
            <textarea
              id="reply-body"
              className="w-full rounded border border-slate-300 p-2 text-sm"
              rows={3}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="Write a reply to the ticket owner…"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={isInternalNote}
                onChange={(event) => setIsInternalNote(event.target.checked)}
              />
              Internal note only (not visible to the ticket owner, no notification sent)
            </label>
            <button
              type="button"
              onClick={() => void handleReply()}
              disabled={isSending}
              className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSending ? 'Sending…' : isInternalNote ? 'Add internal note' : 'Send reply'}
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
