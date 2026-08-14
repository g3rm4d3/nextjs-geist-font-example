import { schema } from '@rideshare/database';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';

export type PricingConfigRow = typeof schema.pricingConfigs.$inferSelect;

/**
 * At most one row can have active = true (packages/database's
 * pricing_configs_one_active_key partial unique index) — the pricing
 * engine can safely assume "the active row" is unambiguous.
 */
export async function findActivePricingConfig(): Promise<PricingConfigRow | undefined> {
  const [config] = await db
    .select()
    .from(schema.pricingConfigs)
    .where(eq(schema.pricingConfigs.active, true))
    .limit(1);
  return config;
}

/** Section 14's "Pricing" — full history, newest first, so an admin can
 * see what changed and when (every past config stays in the table, per
 * this schema's own design; nothing here ever deletes a row). */
export async function listPricingConfigs(): Promise<PricingConfigRow[]> {
  return db.select().from(schema.pricingConfigs).orderBy(desc(schema.pricingConfigs.createdAt));
}

export interface CreatePricingConfigInput {
  name: string;
  baseFareCents: number;
  perMileRateCents: number;
  perMinuteRateCents: number;
  minimumFareCents: number;
  bookingFeeCents: number;
  cancellationFeeCents: number;
  platformCommissionPercentage: number;
}

/**
 * "Change pricing": inserts a new, distinctly-named config and makes it
 * the active one, deactivating whichever config was active before — all
 * in one transaction. Never mutates an existing row's numbers in place,
 * so pricing history stays intact and `pricing_configs_one_active_key`
 * (at most one active row) is never briefly violated mid-write.
 */
export async function createPricingConfig(input: CreatePricingConfigInput): Promise<PricingConfigRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(schema.pricingConfigs)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(schema.pricingConfigs.active, true));

    const [created] = await tx
      .insert(schema.pricingConfigs)
      .values({
        name: input.name,
        baseFareCents: input.baseFareCents,
        perMileRateCents: input.perMileRateCents,
        perMinuteRateCents: input.perMinuteRateCents,
        minimumFareCents: input.minimumFareCents,
        bookingFeeCents: input.bookingFeeCents,
        cancellationFeeCents: input.cancellationFeeCents,
        platformCommissionPercentage: input.platformCommissionPercentage.toFixed(2),
        active: true,
      })
      .returning();
    if (!created) throw new Error('Failed to create pricing config');
    return created;
  });
}
