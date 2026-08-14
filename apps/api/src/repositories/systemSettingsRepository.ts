import { schema } from '@rideshare/database';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type SystemSettingRow = typeof schema.systemSettings.$inferSelect;

/** Section 14's "System Settings" — every key, alphabetical. */
export async function listSettings(): Promise<SystemSettingRow[]> {
  return db.select().from(schema.systemSettings).orderBy(asc(schema.systemSettings.key));
}

export async function findSettingByKey(key: string): Promise<SystemSettingRow | undefined> {
  const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, key)).limit(1);
  return row;
}

export interface UpsertSettingInput {
  key: string;
  value: unknown;
  description?: string | null;
  updatedBy: string;
}

/**
 * Insert-or-update by key (`system_settings_key_key` is the uniqueness
 * guarantee). Unlike pricing configs, settings are simple key/value state
 * with no history requirement, so this genuinely mutates in place.
 */
export async function upsertSetting(input: UpsertSettingInput): Promise<SystemSettingRow> {
  const [row] = await db
    .insert(schema.systemSettings)
    .values({
      key: input.key,
      value: input.value,
      description: input.description ?? null,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: schema.systemSettings.key,
      set: {
        value: input.value,
        description: input.description ?? null,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('Failed to upsert system setting');
  return row;
}
