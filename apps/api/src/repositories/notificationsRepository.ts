import { schema } from '@rideshare/database';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';

export type NotificationRow = typeof schema.notifications.$inferSelect;
export type PushTokenRow = typeof schema.pushTokens.$inferSelect;

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: unknown;
}

/** Phase 16's central write path — every event funnels through this one
 * insert (see services/notificationService.ts's `notify`). */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert notification');
  return row;
}

const DEFAULT_LIST_LIMIT = 50;

/** A user's own in-app notification list, most recent first — same
 * "most recent first, no server-side unread filter" shape as a driver's
 * document list (documentsRepository.findDocumentsByDriver); the client
 * decides what to show for "unread only". */
export async function listNotificationsForUser(
  userId: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
}

/** Badge count for GET /notifications's response — cheaper than the
 * client counting `readAt === null` across the (limited) list page. */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return row?.total ?? 0;
}

/** POST /notifications/:id/read — scoped to `userId` so one user can't
 * mark another user's notification read by guessing an id; no-op (not
 * an error) if already read, matching the general "marking something
 * already-in-the-target-state is not a conflict" convention for
 * idempotent client retries. */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<NotificationRow | undefined> {
  const [updated] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, notificationId),
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning();
  if (updated) return updated;
  // Already read (or not this user's) — distinguish "not found at all"
  // from "already read" so the route can still 404 on a genuinely wrong id.
  const [existing] = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, userId)))
    .limit(1);
  return existing;
}

/** POST /notifications/read-all. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

export interface UpsertPushTokenInput {
  userId: string;
  token: string;
  platform?: string;
}

/** POST /notifications/push-token. `token` is globally unique
 * (push_tokens_token_key) — see packages/database/src/schema/pushTokens.ts
 * for why re-registering the same token under a different user updates
 * the row's owner rather than creating a duplicate. */
export async function upsertPushToken(input: UpsertPushTokenInput): Promise<PushTokenRow> {
  const [row] = await db
    .insert(schema.pushTokens)
    .values({
      userId: input.userId,
      token: input.token,
      platform: input.platform ?? null,
    })
    .onConflictDoUpdate({
      target: schema.pushTokens.token,
      set: {
        userId: input.userId,
        platform: input.platform ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('Failed to upsert push token');
  return row;
}

/** DELETE /notifications/push-token — e.g. on logout, so a shared/reset
 * device stops receiving a signed-out user's pushes. Scoped to `userId`:
 * only the token's current owner can unregister it. */
export async function deletePushToken(token: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.pushTokens)
    .where(and(eq(schema.pushTokens.token, token), eq(schema.pushTokens.userId, userId)))
    .returning({ id: schema.pushTokens.id });
  return deleted.length > 0;
}

/** notificationService's push-dispatch step: every device currently
 * registered to this user (a user can be logged in on more than one
 * device). */
export async function findPushTokensForUser(userId: string): Promise<PushTokenRow[]> {
  return db.select().from(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));
}
