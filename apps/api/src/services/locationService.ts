import type {
  DriverLocation,
  DriverLocationPing,
  FleetDriverLocation,
  RecordLocationResult,
} from '@rideshare/types';
import { ValidationError } from '../lib/errors';
import { findDriverProfileByUserId } from '../repositories/usersRepository';
import {
  findDriverLocation,
  listFleetLocations,
  upsertDriverLocation,
  type DriverLocationRow,
  type FleetLocationRow,
} from '../repositories/locationsRepository';

/**
 * A location older than this is still returned (never hidden) but
 * flagged `isStale: true` — the concrete answer to "handle stale GPS"
 * for anything that reads a driver's position (the admin map here;
 * Phase 8's matchingRepository.findEligibleDrivers, which imports this
 * same constant for its own "recent valid location" eligibility check —
 * section 8's own wording — rather than defining a second one that could
 * drift out of sync with this file's).
 */
export const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * A ping whose client-supplied timestamp is further in the future than
 * this is almost certainly bad clock data, not a real location update —
 * rejected outright rather than silently accepted and treated as fresh.
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * "Avoid excessive database writes" (section 6): a driver's location
 * only actually persists at most once per this interval, no matter how
 * often the client pings. Faster pings still succeed (2xx) so the
 * client never needs its own throttling logic or error handling for
 * this — they just don't all reach the database. See
 * RecordLocationResult.written for how a caller can tell the
 * difference.
 */
const MIN_WRITE_INTERVAL_MS = 2000;

function toDriverLocation(row: DriverLocationRow | FleetLocationRow): DriverLocation {
  const isStale = Date.now() - row.recordedAt.getTime() > STALE_THRESHOLD_MS;
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    heading: row.heading,
    speed: row.speed,
    accuracy: row.accuracy,
    recordedAt: row.recordedAt.toISOString(),
    isStale,
  };
}

function resolveRecordedAt(ping: DriverLocationPing): Date {
  if (!ping.timestamp) return new Date();

  const recordedAt = new Date(ping.timestamp);
  if (recordedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new ValidationError('timestamp is too far in the future');
  }
  // Deliberately no lower bound: an old-but-valid timestamp is exactly
  // what "stale GPS" produces, and the point is to store and flag it
  // (isStale), not reject it outright.
  return recordedAt;
}

async function requireDriverId(userId: string): Promise<string> {
  const profile = await findDriverProfileByUserId(userId);
  if (!profile) throw new Error('Driver profile not found for authenticated driver user');
  return profile.id;
}

export async function recordLocation(
  userId: string,
  ping: DriverLocationPing,
): Promise<RecordLocationResult> {
  const driverId = await requireDriverId(userId);
  const recordedAt = resolveRecordedAt(ping);

  const existing = await findDriverLocation(driverId);
  const sinceLastWrite = existing ? Date.now() - existing.updatedAt.getTime() : Infinity;

  if (existing && sinceLastWrite < MIN_WRITE_INTERVAL_MS) {
    return { location: toDriverLocation(existing), written: false };
  }

  const row = await upsertDriverLocation(driverId, {
    latitude: ping.latitude,
    longitude: ping.longitude,
    heading: ping.heading ?? null,
    speed: ping.speed ?? null,
    accuracy: ping.accuracy ?? null,
    recordedAt,
  });

  return { location: toDriverLocation(row), written: true };
}

export async function getFleetLocations(): Promise<FleetDriverLocation[]> {
  const rows = await listFleetLocations();
  return rows.map((row) => ({
    ...toDriverLocation(row),
    driverId: row.driverId,
    firstName: row.firstName,
    lastName: row.lastName,
    availabilityStatus: row.availabilityStatus,
  }));
}
