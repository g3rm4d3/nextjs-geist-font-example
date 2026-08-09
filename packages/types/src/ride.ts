/**
 * Section 12's ride lifecycle states — duplicated by hand from
 * packages/database/src/schema/enums.ts's rideStatusEnum, same
 * dependency-free convention as every other type in this package (see
 * docs/architecture.md). Only REQUESTED and SEARCHING_DRIVER are ever
 * produced by anything built so far (Phase 7); the rest exist here
 * because a client needs the full union to type a `status` field at
 * all, not because this phase can put a ride into any of them.
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

/** What POST /rides returns — the created (or, on an idempotent replay,
 * the pre-existing) ride. */
export interface Ride {
  id: string;
  status: RideStatus;
  pickup: NamedLocation;
  destination: NamedLocation;
  estimatedDistanceMeters: number | null;
  estimatedDurationSeconds: number | null;
  estimatedFareCents: number | null;
  requestedAt: string;
}
