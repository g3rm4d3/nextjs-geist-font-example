import type { Vehicle } from './driver';
import type { DriverLocation } from './location';

/**
 * Section 12's ride lifecycle states — duplicated by hand from
 * packages/database/src/schema/enums.ts's rideStatusEnum, same
 * dependency-free convention as every other type in this package (see
 * docs/architecture.md). As of Phase 9, every one of these is a real,
 * reachable state — see docs/ride-lifecycle.md for the full state
 * machine (which transitions are legal, who can trigger each one).
 */
export type RideStatus =
  | 'REQUESTED'
  | 'SEARCHING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_EN_ROUTE'
  | 'DRIVER_ARRIVED'
  | 'PASSENGER_ONBOARD'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED_BY_PASSENGER'
  | 'CANCELLED_BY_DRIVER'
  | 'CANCELLED_BY_SYSTEM';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** A pickup or destination point: where, plus a human-readable label for
 * display (matches apps/passenger-app's RideDraftContext.NamedPoint —
 * the client can send its draft pickup/destination straight through). */
export interface NamedLocation {
  coordinate: Coordinate;
  label: string;
}

/**
 * The request contract for POST /rides. `idempotencyKey` is required,
 * not optional — a key nobody remembers to reuse across a retry can't
 * do its job. There is deliberately no fare field anywhere in this
 * shape: fares are never client-supplied (section 3), only ever
 * computed server-side from pickup/destination.
 */
export interface CreateRideRequest {
  pickup: NamedLocation;
  destination: NamedLocation;
  idempotencyKey: string;
}

/** The full ride record every ride-related endpoint returns — created,
 * accepted, advanced through the lifecycle, or cancelled, always this
 * same shape. `actual*`/`finalFareCents` are null until COMPLETED (see
 * rideLifecycleService.completeRide); `cancellationReason` is null
 * unless `status` is one of the three `CANCELLED_BY_*` values. */
export interface Ride {
  id: string;
  status: RideStatus;
  pickup: NamedLocation;
  destination: NamedLocation;
  estimatedDistanceMeters: number | null;
  estimatedDurationSeconds: number | null;
  estimatedFareCents: number | null;
  actualDistanceMeters: number | null;
  actualDurationSeconds: number | null;
  finalFareCents: number | null;
  cancellationReason: string | null;
  requestedAt: string;
}

/**
 * Phase 8: what GET /drivers/me/offer returns to a driver with a
 * currently-open (OFFERED) ride_requests row — the ride details they
 * need to decide, plus how long they have left to respond. `id` here is
 * the ride_request's id (what POST .../accept and .../decline take as
 * a path param), not the ride's id — the ride's own id is nested inside
 * `ride`.
 */
export interface RideOffer {
  id: string;
  ride: Ride;
  expiresAt: string;
}

/**
 * Phase 10: what `GET /rides/:id/driver` returns to the ride's own
 * passenger once a driver is assigned — `null` before that (still
 * `SEARCHING_DRIVER`/`REQUESTED`) and *after* `COMPLETED`/cancellation
 * (nothing left to track). `location` is `null` only in the edge case of
 * an assigned driver who has never sent a single location ping — expected
 * to be rare/transient, not a normal steady state.
 *
 * `firstName` only (section 10's own list: "driver first name," not a
 * full name) — the client renders a placeholder avatar from it (an
 * initial), not a real photo; see docs/realtime-ride-experience.md for
 * why "driver photo placeholder/test photo" stops there in Stage 1.
 */
export interface AssignedRideDriverInfo {
  firstName: string;
  vehicle: Vehicle | null;
  location: DriverLocation | null;
  /** Seconds to whichever point currently matters — pickup pre-onboard,
   * destination once onboard — or `null` if it can't currently be
   * computed (no location on file for this driver yet). */
  estimatedArrivalSeconds: number | null;
}

/** Phase 10: one row of the admin "active rides" view (`GET
 * /admin/rides/active`) — every non-terminal ride, driver/vehicle fields
 * `null` until one is assigned. */
export interface AdminActiveRide {
  id: string;
  status: RideStatus;
  passengerName: string;
  driverName: string | null;
  vehicle: Vehicle | null;
  pickup: NamedLocation;
  destination: NamedLocation;
  requestedAt: string;
}
