import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
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
