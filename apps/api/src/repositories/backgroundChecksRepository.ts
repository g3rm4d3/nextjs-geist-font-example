import { schema } from '@rideshare/database';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type BackgroundCheckRow = typeof schema.backgroundChecks.$inferSelect;

export interface CreateBackgroundCheckInput {
  driverId: string;
  requestedBy: string;
  status: BackgroundCheckRow['status'];
  providerReportId: string;
  completedAt: Date;
}

/** One row per background-check run — see the schema's own comment on
 * why every past run stays in the table rather than being overwritten. */
export async function createBackgroundCheck(
  input: CreateBackgroundCheckInput,
): Promise<BackgroundCheckRow> {
  const [row] = await db.insert(schema.backgroundChecks).values(input).returning();
  if (!row) throw new Error('Failed to insert background check');
  return row;
}

/** "Inspect driver": the most recent run only, not the full history —
 * an admin deciding whether a driver is currently cleared needs the
 * latest result, not a log to scroll through. */
export async function findLatestBackgroundCheckForDriver(
  driverId: string,
): Promise<BackgroundCheckRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.backgroundChecks)
    .where(eq(schema.backgroundChecks.driverId, driverId))
    .orderBy(desc(schema.backgroundChecks.requestedAt))
    .limit(1);
  return row;
}
