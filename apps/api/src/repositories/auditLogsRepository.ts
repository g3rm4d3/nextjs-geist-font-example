import { schema } from '@rideshare/database';
import { desc } from 'drizzle-orm';
import { db } from '../db/client';

export type AuditLogRow = typeof schema.auditLogs.$inferSelect;

export interface CreateAuditLogInput {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  requestId?: string | null;
}

/** Append-only (section 14) — no update/delete function exists here on
 * purpose; nothing in this codebase ever modifies an audit_logs row
 * after it's written. */
export async function createAuditLog(input: CreateAuditLogInput): Promise<AuditLogRow> {
  const [row] = await db
    .insert(schema.auditLogs)
    .values({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      ipAddress: input.ipAddress ?? null,
      requestId: input.requestId ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create audit log entry');
  return row;
}

const DEFAULT_AUDIT_LOG_LIMIT = 100;

export async function listAuditLogs(limit = DEFAULT_AUDIT_LOG_LIMIT): Promise<AuditLogRow[]> {
  return db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt)).limit(limit);
}
