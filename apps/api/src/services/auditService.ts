import type { AdminAuditLogEntry } from '@rideshare/types';
import { createAuditLog, listAuditLogs, type AuditLogRow } from '../repositories/auditLogsRepository';

export interface RecordAuditLogInput {
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  requestId?: string | null;
}

function toEntry(row: AuditLogRow): AdminAuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Section 14: "Sensitive admin operations generate audit records."
 * Called by every mutating admin action (driver moderation, document
 * review, pricing changes, system settings writes) — never by read-only
 * "inspect" actions, which change no state and so have nothing to
 * record. Takes plain values rather than an Express `req`, same as
 * every other service in this codebase — the route handler is
 * responsible for pulling `actorUserId`/`actorRole` off `req.auth` and
 * `requestId`/`ipAddress` off the request itself.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  await createAuditLog(input);
}

/** Section 14's "Audit Logs" admin section — most recent first. */
export async function getAuditLogs(limit?: number): Promise<AdminAuditLogEntry[]> {
  const rows = await listAuditLogs(limit);
  return rows.map(toEntry);
}
