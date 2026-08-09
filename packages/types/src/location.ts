import type { DriverAvailabilityStatus } from './auth';

/**
 * Section 6/Phase 6: the request contract for a driver's location ping.
 * Mirrors @rideshare/validation's driverLocationPingSchema by hand,
 * same reasoning as every other type in this dependency-free package
 * (see docs/architecture.md).
 */
export interface DriverLocationPing {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp?: string;
}

/** A driver's stored/returned current location. */
export interface DriverLocation {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  /** When this fix was actually recorded (client-supplied timestamp, or
   * server-received time if the client didn't send one) — not
   * necessarily "now". */
  recordedAt: string;
  /** True once `recordedAt` is older than the server's staleness
   * threshold — see docs/location-infrastructure.md. A stale location is
   * still returned, never hidden; callers (e.g. future matching logic)
   * decide what to do with it. */
  isStale: boolean;
}

export interface RecordLocationResult {
  location: DriverLocation;
  /** False when this ping arrived faster than the minimum write
   * interval and was therefore not persisted — the response still
   * reflects the last *stored* location, not the just-received one.
   * "Avoid excessive database writes" (section 6), made observable. */
  written: boolean;
}

/** One row of the admin live fleet map (Phase 6's "Admin App should
 * display virtual drivers on map" requirement). */
export interface FleetDriverLocation extends DriverLocation {
  driverId: string;
  firstName: string;
  lastName: string;
  availabilityStatus: DriverAvailabilityStatus;
}
