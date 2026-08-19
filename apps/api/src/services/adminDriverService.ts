import type { AdminDocumentSummary, AdminDriverDetail, AdminDriverSummary } from '@rideshare/types';
import { ConflictError, NotFoundError } from '../lib/errors';
import { toVehicle } from '../lib/vehicleMapper';
import type { AuditActorContext } from '../lib/auditContext';
import {
  approveDriver as approveDriverRow,
  findActiveVehicleForDriver,
  findDriverAdminRowById,
  listDrivers as listDriversRows,
  reactivateDriver as reactivateDriverRow,
  rejectDriver as rejectDriverRow,
  suspendDriver as suspendDriverRow,
  type DriverAdminRow,
} from '../repositories/driversRepository';
import { findDocumentsByDriver } from '../repositories/documentsRepository';
import { logger } from '../lib/logger';
import { getLatestBackgroundCheck } from './adminBackgroundCheckService';
import { recordAuditLog } from './auditService';
import { notifyDriverApproved, notifyDriverRejected } from './notificationService';

type DriverOnboardingStatus = AdminDriverSummary['onboardingStatus'];

function toSummary(row: DriverAdminRow): AdminDriverSummary {
  return {
    id: row.id,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isActive: row.isActive,
    onboardingStatus: row.onboardingStatus,
    availabilityStatus: row.availabilityStatus,
    averageRating: row.averageRating !== null ? Number(row.averageRating) : null,
    ratingsCount: row.ratingsCount,
    totalRides: row.totalRides,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDocumentSummary(
  row: Awaited<ReturnType<typeof findDocumentsByDriver>>[number],
  driverName: string,
): AdminDocumentSummary {
  return {
    id: row.id,
    driverId: row.driverId,
    driverName,
    documentType: row.documentType,
    reviewStatus: row.reviewStatus,
    uploadedAt: row.uploadedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
  };
}

/** Section 14: "Drivers." `onboardingStatus` filter doubles as the
 * "Driver Applications" section — that's just this list scoped to
 * PENDING_REVIEW, not a separate backend concept. */
export async function listDrivers(onboardingStatus?: DriverOnboardingStatus): Promise<AdminDriverSummary[]> {
  const rows = await listDriversRows(onboardingStatus);
  return rows.map(toSummary);
}

/** "Inspect driver" (grouped under the spec's driver-moderation actions,
 * not literally named but the natural read half of approve/reject/
 * suspend/reactivate) — profile, current vehicle, and every document. */
export async function getDriverDetail(driverId: string): Promise<AdminDriverDetail> {
  const row = await findDriverAdminRowById(driverId);
  if (!row) throw new NotFoundError('Driver not found');

  const [vehicleRow, documentRows, latestBackgroundCheck] = await Promise.all([
    findActiveVehicleForDriver(driverId),
    findDocumentsByDriver(driverId),
    getLatestBackgroundCheck(driverId),
  ]);

  const driverName = `${row.firstName} ${row.lastName}`;

  return {
    ...toSummary(row),
    licenseNumber: row.licenseNumber,
    licenseState: row.licenseState,
    licenseExpiresAt: row.licenseExpiresAt ? row.licenseExpiresAt.toISOString() : null,
    vehicle: vehicleRow ? toVehicle(vehicleRow) : null,
    documents: documentRows.map((doc) => toDocumentSummary(doc, driverName)),
    latestBackgroundCheck,
  };
}

async function auditDriverAction(
  actor: AuditActorContext,
  action: string,
  driverId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await recordAuditLog({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action,
    entityType: 'driver_profile',
    entityId: driverId,
    before,
    after,
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
  });
}

/** "Approve driver": PENDING_REVIEW -> APPROVED only — a 409 if the
 * driver isn't currently awaiting review (already decided, or never
 * submitted an application at all). */
export async function approveDriver(driverId: string, actor: AuditActorContext): Promise<AdminDriverSummary> {
  const updated = await approveDriverRow(driverId);
  if (!updated) {
    throw new ConflictError('Driver is not currently pending review');
  }
  await auditDriverAction(actor, 'driver.approve', driverId, { onboardingStatus: 'PENDING_REVIEW' }, {
    onboardingStatus: 'APPROVED',
  });

  // Phase 16's "driver approval" event. Best-effort, same precedent as
  // rideService.requestRide's startMatching call — the approval itself
  // already succeeded above regardless of notification outcome.
  try {
    await notifyDriverApproved(updated.userId);
  } catch (notificationError) {
    logger.error({ err: notificationError, driverId }, 'Failed to send driver-approved notification');
  }

  const row = await findDriverAdminRowById(driverId);
  if (!row) throw new Error(`Driver ${driverId} disappeared immediately after being approved`);
  return toSummary(row);
}

/** "Reject driver": PENDING_REVIEW -> REJECTED only, reason required
 * (see @rideshare/validation's rejectDriverSchema) and recorded in the
 * audit trail — never surfaced to the driver anywhere in Stage 1 (no
 * driver-facing "why was I rejected" screen yet), but real and queryable
 * by an admin later. */
export async function rejectDriver(
  driverId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<AdminDriverSummary> {
  const updated = await rejectDriverRow(driverId);
  if (!updated) {
    throw new ConflictError('Driver is not currently pending review');
  }
  await auditDriverAction(
    actor,
    'driver.reject',
    driverId,
    { onboardingStatus: 'PENDING_REVIEW' },
    { onboardingStatus: 'REJECTED', reason },
  );

  // Phase 16's "driver rejection" event, same best-effort shape as approve.
  try {
    await notifyDriverRejected(updated.userId, reason);
  } catch (notificationError) {
    logger.error({ err: notificationError, driverId }, 'Failed to send driver-rejected notification');
  }

  const row = await findDriverAdminRowById(driverId);
  if (!row) throw new Error(`Driver ${driverId} disappeared immediately after being rejected`);
  return toSummary(row);
}

/** "Suspend driver" — SUPER_ADMIN only (enforced by the route's
 * requireRole, not here; see docs/admin-application.md on why this is
 * one of the actions distinguishing SUPER_ADMIN from ADMIN). APPROVED ->
 * SUSPENDED only, and forces availabilityStatus OFFLINE in the same
 * update (see driversRepository.suspendDriver's own comment on why
 * that's required, not optional). */
export async function suspendDriver(
  driverId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<AdminDriverSummary> {
  const updated = await suspendDriverRow(driverId);
  if (!updated) {
    throw new ConflictError('Driver is not currently approved');
  }
  await auditDriverAction(
    actor,
    'driver.suspend',
    driverId,
    { onboardingStatus: 'APPROVED' },
    { onboardingStatus: 'SUSPENDED', reason },
  );
  const row = await findDriverAdminRowById(driverId);
  if (!row) throw new Error(`Driver ${driverId} disappeared immediately after being suspended`);
  return toSummary(row);
}

/** "Reactivate driver" — SUPER_ADMIN only, same reasoning as suspend.
 * SUSPENDED -> APPROVED only. */
export async function reactivateDriver(
  driverId: string,
  actor: AuditActorContext,
): Promise<AdminDriverSummary> {
  const updated = await reactivateDriverRow(driverId);
  if (!updated) {
    throw new ConflictError('Driver is not currently suspended');
  }
  await auditDriverAction(actor, 'driver.reactivate', driverId, { onboardingStatus: 'SUSPENDED' }, {
    onboardingStatus: 'APPROVED',
  });
  const row = await findDriverAdminRowById(driverId);
  if (!row) throw new Error(`Driver ${driverId} disappeared immediately after being reactivated`);
  return toSummary(row);
}
