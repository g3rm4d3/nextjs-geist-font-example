import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_helpers';
import { promoDiscountTypeEnum } from './enums';

/**
 * Table only — part of the normalized core schema (section 11). Promo
 * code *redemption logic* is explicitly listed under "do not implement
 * yet" features for Stage 1; no application code reads or writes this
 * table until that phase is authorized. See docs/database.md.
 */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: primaryId(),
    code: text('code').notNull(),
    description: text('description'),
    discountType: promoDiscountTypeEnum('discount_type').notNull(),
    // Percentage (0-100) or fixed cents, depending on discountType.
    discountValue: integer('discount_value').notNull(),
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('promo_codes_code_key').on(table.code),
    check('promo_codes_discount_value_non_negative_chk', sql`${table.discountValue} >= 0`),
    check(
      'promo_codes_percentage_range_chk',
      sql`${table.discountType} <> 'PERCENTAGE' OR ${table.discountValue} <= 100`,
    ),
    check('promo_codes_redeemed_count_non_negative_chk', sql`${table.redeemedCount} >= 0`),
  ],
);
