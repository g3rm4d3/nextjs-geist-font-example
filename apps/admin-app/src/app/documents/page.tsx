'use client';

import type { AdminDocumentSummary } from '@rideshare/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { useAdminAuth } from '@/context/AdminAuthContext';
import {
  ApiClientError,
  listAdminDocuments,
  requestDocumentReplacement,
  reviewDocument,
} from '@/lib/apiClient';

type StatusFilter = AdminDocumentSummary['reviewStatus'] | 'ALL';

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'REPLACEMENT_REQUESTED'];

const EXPIRING_WINDOW_DAYS = 30;

/** Section 14's "Documents" review queue, extended in Phase 15 with a
 * "request replacement" action (distinct from reject) and an "expiring
 * soon" filter — section 15's "internal expiration warnings". */
export default function DocumentsPage() {
  const { accessToken } = useAdminAuth();
  const [documents, setDocuments] = useState<AdminDocumentSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  // See drivers/applications/page.tsx's comment on why this exists —
  // bumping it re-triggers the fetch effect after a write action.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string, statusFilter: StatusFilter, onlyExpiring: boolean) {
      try {
        const result = await listAdminDocuments(
          token,
          statusFilter === 'ALL' ? undefined : statusFilter,
          onlyExpiring ? EXPIRING_WINDOW_DAYS : undefined,
        );
        if (!cancelled) setDocuments(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load documents.');
        }
      }
    }

    void load(accessToken, filter, expiringOnly);
    return () => {
      cancelled = true;
    };
  }, [accessToken, filter, expiringOnly, refreshCount]);

  async function handleApprove(documentId: string) {
    if (!accessToken) return;
    setBusyDocumentId(documentId);
    setErrorMessage(null);
    try {
      await reviewDocument(accessToken, documentId, { approved: true });
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not approve this document.');
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function handleReject(documentId: string) {
    if (!accessToken) return;
    const rejectionReason = (reasonById[documentId] ?? '').trim();
    if (!rejectionReason) {
      setErrorMessage('A rejection reason is required.');
      return;
    }
    setBusyDocumentId(documentId);
    setErrorMessage(null);
    try {
      await reviewDocument(accessToken, documentId, { approved: false, rejectionReason });
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not reject this document.');
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function handleRequestReplacement(documentId: string) {
    if (!accessToken) return;
    const reason = (reasonById[documentId] ?? '').trim();
    if (!reason) {
      setErrorMessage('A reason is required to request a replacement.');
      return;
    }
    setBusyDocumentId(documentId);
    setErrorMessage(null);
    try {
      await requestDocumentReplacement(accessToken, documentId, { reason });
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not request a replacement.',
      );
    } finally {
      setBusyDocumentId(null);
    }
  }

  return (
    <AdminShell title="Documents" subtitle={`${documents.length} document(s)`} errorMessage={errorMessage}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Status:</span>
        {STATUS_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === option ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExpiringOnly((value) => !value)}
          className={`ml-2 rounded-full px-3 py-1 text-xs font-semibold ${
            expiringOnly ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Expiring within {EXPIRING_WINDOW_DAYS} days
        </button>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">No documents match this filter.</p>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <Link href={`/drivers/${doc.driverId}`} className="font-medium text-slate-900 hover:underline">
                  {doc.driverName}
                </Link>
                <p className="text-sm text-slate-500">
                  {doc.documentType} · uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                  {doc.expiresAt ? ` · expires ${new Date(doc.expiresAt).toLocaleDateString()}` : ''}
                </p>
                <p className="text-xs text-slate-500">
                  Status: {doc.reviewStatus}
                  {doc.rejectionReason ? ` — ${doc.rejectionReason}` : ''}
                </p>
              </div>
              {(doc.reviewStatus === 'PENDING' || doc.reviewStatus === 'APPROVED') && (
                <div className="flex flex-wrap items-center gap-2">
                  {doc.reviewStatus === 'PENDING' && (
                    <button
                      type="button"
                      disabled={busyDocumentId === doc.id}
                      onClick={() => void handleApprove(doc.id)}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  <input
                    placeholder="Reason"
                    value={reasonById[doc.id] ?? ''}
                    onChange={(event) =>
                      setReasonById((previous) => ({ ...previous, [doc.id]: event.target.value }))
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  {doc.reviewStatus === 'PENDING' && (
                    <button
                      type="button"
                      disabled={busyDocumentId === doc.id}
                      onClick={() => void handleReject(doc.id)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyDocumentId === doc.id}
                    onClick={() => void handleRequestReplacement(doc.id)}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Request replacement
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
