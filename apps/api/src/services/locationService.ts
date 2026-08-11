import type {
  DriverLocation,
  DriverLocationPing,
  FleetDriverLocation,
  RecordLocationResult,
} from '@rideshare/types';
import { env } from '../config/env';
import { ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import {
  findDriverLocation,
  listFleetLocations,
  upsertDriverLocation,
  type DriverLocationRow,
  type FleetLocationRow,
} from '../repositories/locationsRepository';
import {
  findLatestRideLocationSample,
  insertRideLocationSample,
} from '../repositories/rideLocationSamplesRepository';
import { findActiveRideForDriver } from '../repositories/ridesRepository';
import { findDriverProfileByUserId } from '../repositories/usersRepository';

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

/** Exported for rideTrackingService (Phase 10), which needs the exact
 * same row -> DriverLocation + isStale mapping for a driver's current
 * position while showing a passenger their assigned driver. */
export function toDriverLocation(row: DriverLocationRow | FleetLocationRow): DriverLocation {
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

  const result: RecordLocationResult =
    existing && sinceLastWrite < MIN_WRITE_INTERVAL_MS
      ? { location: toDriverLocation(existing), written: false }
      : {
          location: toDriverLocation(
            await upsertDriverLocation(driverId, {
              latitude: ping.latitude,
              longitude: ping.longitude,
              heading: ping.heading ?? null,
              speed: ping.speed ?? null,
              accuracy: ping.accuracy ?? null,
              recordedAt,
            }),
          ),
          written: true,
        };

  // Phase 10: "track actual ride ... route samples", independently
  // throttled and gated to a ride that's actually IN_PROGRESS — see
  // recordRouteSampleIfDue. Best-effort: a failure here (or simply this
  // driver having no active ride, the overwhelmingly common case) must
  // never fail the location ping itself, which every driver-app poll
  // depends on succeeding regardless of ride state.
  try {
    await recordRouteSampleIfDue(driverId, ping, recordedAt);
  } catch (error) {
    logger.error({ err: error, driverId }, 'Failed to record ride location sample');
  }

  return result;
}

/**
 * "Use configurable GPS sampling. Do not persist unnecessary high-
 * frequency data." — a second, coarser throttle (RIDE_LOCATION_SAMPLE_INTERVAL_MS,
 * independent of MIN_WRITE_INTERVAL_MS above) governing how often a
 * breadcrumb is appended to `ride_location_samples` for the ride
 * currently IN_PROGRESS, if any. Deliberately scoped to IN_PROGRESS only
 * — not DRIVER_EN_ROUTE/DRIVER_ARRIVED — matching Phase 9's own
 * definition of "the actual ride" as the started_at..completed_at
 * window; a driver navigating to pickup is not yet "on the ride" this
 * table is a history of.
 */
async function recordRouteSampleIfDue(
  driverId: string,
  ping: DriverLocationPing,
  recordedAt: Date,
): Promise<void> {
  const activeRide = await findActiveRideForDriver(driverId);
  if (!activeRide || activeRide.status !== 'IN_PROGRESS') return;

  const latestSample = await findLatestRideLocationSample(activeRide.id);
  const sinceLastSample = latestSample ? Date.now() - latestSample.recordedAt.getTime() : Infinity;
  if (sinceLastSample < env.RIDE_LOCATION_SAMPLE_INTERVAL_MS) return;

  await insertRideLocationSample(activeRide.id, {
    latitude: ping.latitude,
    longitude: ping.longitude,
    heading: ping.heading ?? null,
    speed: ping.speed ?? null,
    accuracy: ping.accuracy ?? null,
    recordedAt,
  });
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
