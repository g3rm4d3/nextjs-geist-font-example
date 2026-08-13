/**
 * Ratings API contract (Phase 13), shared by apps/api (producer) and
 * passenger-app/driver-app (consumers). Mirrors
 * @rideshare/database's ratings row and rating_direction enum by hand
 * rather than importing them — this package stays dependency-free on
 * purpose (see docs/architecture.md).
 */
export type RatingDirection = 'PASSENGER_TO_DRIVER' | 'DRIVER_TO_PASSENGER';

export interface Rating {
  id: string;
  rideId: string;
  direction: RatingDirection;
  stars: number;
  comment: string | null;
  createdAt: string;
}

/** GET .../ratings' shape — a completed ride can have up to one rating
 * per direction (section 13: "one rating per direction per completed
 * ride"), so each side is present or `null`, never a list. */
export interface RideRatings {
  passengerToDriver: Rating | null;
  driverToPassenger: Rating | null;
}
