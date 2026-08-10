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
