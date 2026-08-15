import type { BackgroundCheckSummary } from '@rideshare/types';
import { backgroundCheckProvider } from '../lib/backgroundCheckProvider';
import type { AuditActorContext } from '../lib/auditContext';
import { NotFoundError } from '../lib/errors';
import {
  createBackgroundCheck,
  findLatestBackgroundCheckForDriver,
  type BackgroundCheckRow,
} from '../repositories/backgroundChecksRepository';
import { findDriverAdminRowById } from '../repositories/driversRepository';
import { recordAuditLog } from './auditService';

function toSummary(row: BackgroundCheckRow): BackgroundCheckSummary {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/** "Inspect driver": the most recent background-check run, or null if
 * none has ever been triggered. */
export async function getLatestBackgroundCheck(driverId: string): Promise<BackgroundCheckSummary | null> {
  const row = await findLatestBackgroundCheckForDriver(driverId);
  return row ? toSummary(row) : null;
}

/**
 * Section 13's BackgroundCheckProvider, wired into section 15's driver
 * document management — ADMIN+ (the same "routine driver-moderation-
 * adjacent action" classification as approve/reject/document review,
 * not SUPER_ADMIN-only; see docs/document-management.md's SUPER_ADMIN-
 * vs-ADMIN reasoning). Always the MOCK provider in Stage 1 — a real
 * background check is explicitly out of scope for this platform.
 */
export async function runBackgroundCheck(
  driverId: string,
  actor: AuditActorContext,
): Promise<BackgroundCheckSummary> {
  const driver = await findDriverAdminRowById(driverId);
  if (!driver) throw new NotFoundError('Driver not found');

  const result = await backgroundCheckProvider.runCheck({
    driverId,
    fullName: `${driver.firstName} ${driver.lastName}`,
    licenseNumber: driver.licenseNumber,
    licenseState: driver.licenseState,
  });

  const row = await createBackgroundCheck({
    driverId,
    requestedBy: actor.userId,
    status: result.status,
    providerReportId: result.providerReportId,
    completedAt: result.completedAt,
  });

  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: 'driver.background_check',
    entityType: 'driver_profile',
    entityId: driverId,
    before: null,
    after: { status: row.status, providerReportId: row.providerReportId },
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });

  return toSummary(row);
}
