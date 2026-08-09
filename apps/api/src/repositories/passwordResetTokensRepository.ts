import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';

export type PasswordResetTokenRow = typeof schema.passwordResetTokens.$inferSelect;

export interface CreatePasswordResetTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function createPasswordResetToken(
  input: CreatePasswordResetTokenInput,
): Promise<PasswordResetTokenRow> {
  const [row] = await db.insert(schema.passwordResetTokens).values(input).returning();
  if (!row) throw new Error('Failed to insert password reset token');
  return row;
}

export async function findPasswordResetTokenByHash(
  tokenHash: string,
): Promise<PasswordResetTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function markPasswordResetTokenUsed(id: string): Promise<void> {
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.id, id));
}
