import type { AdminPricingConfig } from '@rideshare/types';
import type { ChangePricingInput } from '@rideshare/validation';
import type { AuditActorContext } from '../lib/auditContext';
import { ConflictError } from '../lib/errors';
import { isUniqueViolation } from '../lib/pgErrors';
import {
  createPricingConfig,
  findActivePricingConfig,
  listPricingConfigs,
  type PricingConfigRow,
} from '../repositories/pricingConfigsRepository';
import { recordAuditLog } from './auditService';

function toAdminConfig(row: PricingConfigRow): AdminPricingConfig {
  return {
    id: row.id,
    name: row.name,
    baseFareCents: row.baseFareCents,
    perMileRateCents: row.perMileRateCents,
    perMinuteRateCents: row.perMinuteRateCents,
    minimumFareCents: row.minimumFareCents,
    bookingFeeCents: row.bookingFeeCents,
    cancellationFeeCents: row.cancellationFeeCents,
    platformCommissionPercentage: Number(row.platformCommissionPercentage),
    active: row.active,
    effectiveAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Section 14's "Pricing" — full version history, newest first. */
export async function listPricing(): Promise<AdminPricingConfig[]> {
  const rows = await listPricingConfigs();
  return rows.map(toAdminConfig);
}

export async function getActivePricing(): Promise<AdminPricingConfig | null> {
  const row = await findActivePricingConfig();
  return row ? toAdminConfig(row) : null;
}

/**
 * "Change pricing" — SUPER_ADMIN only (enforced by the route's
 * requireRole; platform-wide financial impact is exactly the kind of
 * action docs/admin-application.md singles out as SUPER_ADMIN-distinct).
 * Always creates a new named version rather than editing the active one
 * in place — see pricingConfigsRepository.createPricingConfig.
 */
export async function changePricing(
  input: ChangePricingInput,
  actor: AuditActorContext,
): Promise<AdminPricingConfig> {
  const previouslyActive = await findActivePricingConfig();

  let created: PricingConfigRow;
  try {
    created = await createPricingConfig(input);
  } catch (error) {
    if (isUniqueViolation(error, 'pricing_configs_name_key')) {
      throw new ConflictError(`A pricing config named "${input.name}" already exists`);
    }
    throw error;
  }

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'pricing.change',
    entityType: 'pricing_config',
    entityId: created.id,
    before: previouslyActive ? toAdminConfig(previouslyActive) : null,
    after: toAdminConfig(created),
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  return toAdminConfig(created);
}
