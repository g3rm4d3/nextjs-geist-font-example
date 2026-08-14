import type { AdminSystemSetting } from '@rideshare/types';
import type { UpsertSystemSettingInput } from '@rideshare/validation';
import type { AuditActorContext } from '../lib/auditContext';
import {
  findSettingByKey,
  listSettings,
  upsertSetting,
  type SystemSettingRow,
} from '../repositories/systemSettingsRepository';
import { recordAuditLog } from './auditService';

function toAdminSetting(row: SystemSettingRow): AdminSystemSetting {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** Section 14's "System Settings" — every key, alphabetical. */
export async function listSystemSettings(): Promise<AdminSystemSetting[]> {
  const rows = await listSettings();
  return rows.map(toAdminSetting);
}

/**
 * Insert-or-update a single key — SUPER_ADMIN only (enforced by the
 * route's requireRole). Unlike pricing, settings genuinely mutate in
 * place; the audit log is what preserves the change history.
 */
export async function upsertSystemSetting(
  key: string,
  input: UpsertSystemSettingInput,
  actor: AuditActorContext,
): Promise<AdminSystemSetting> {
  const before = await findSettingByKey(key);

  const row = await upsertSetting({
    key,
    value: input.value,
    description: input.description ?? before?.description ?? null,
    updatedBy: actor.userId,
  });

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'settings.upsert',
    entityType: 'system_setting',
    entityId: row.id,
    before: before ? toAdminSetting(before) : null,
    after: toAdminSetting(row),
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  return toAdminSetting(row);
}
