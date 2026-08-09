import { schema } from '@rideshare/database';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';

export type SessionRow = typeof schema.sessions.$inferSelect;

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export async function createSession(input: CreateSessionInput): Promise<SessionRow> {
  const [session] = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    })
    .returning();
  if (!session) throw new Error('Failed to insert session');
  return session;
}

export async function findSessionByTokenHash(
  refreshTokenHash: string,
): Promise<SessionRow | undefined> {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
    .limit(1);
  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

/** Used on password reset and on refresh-token-reuse detection. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
}
