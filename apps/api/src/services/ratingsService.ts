import type { Rating, RideRatings } from '@rideshare/types';
import { ConflictError, NotFoundError } from '../lib/errors';
import {
  createRating,
  findRatingByRideAndDirection,
  findRatingsForRide,
  sumRatingsForRatee,
  updateDriverRatingAggregate,
  updatePassengerRatingAggregate,
  type RatingRow,
} from '../repositories/ratingsRepository';
import { findRideById } from '../repositories/ridesRepository';
import {
  findDriverProfileById,
  findDriverProfileByUserId,
  findPassengerProfileById,
  findPassengerProfileByUserId,
} from '../repositories/usersRepository';

function toRating(row: RatingRow): Rating {
  return {
    id: row.id,
    rideId: row.rideId,
    direction: row.direction,
    stars: row.stars,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface SubmitRatingInput {
  stars: number;
  comment?: string;
}

/**
 * Section 13: "Passenger rates Driver." Only legal once the ride is
 * COMPLETED ("ratings unavailable before ride completion") and only
 * once per ride ("one rating per direction per completed ride") — the
 * second check-first here is a friendly 409 alongside
 * ratings_ride_direction_key's own unique index actually enforcing it,
 * the same "read-first for a nice error, constraint for the real
 * guarantee" split used throughout this codebase.
 */
export async function submitPassengerToDriverRating(
  rideId: string,
  userId: string,
  input: SubmitRatingInput,
): Promise<Rating> {
  const passenger = await findPassengerProfileByUserId(userId);
  if (!passenger) throw new Error('Passenger profile not found for authenticated passenger user');

  const ride = await findRideById(rideId);
  if (!ride || ride.passengerId !== passenger.id) {
    throw new NotFoundError('Ride not found');
  }
  if (ride.status !== 'COMPLETED' || !ride.driverId) {
    throw new ConflictError('Ratings are unavailable before ride completion');
  }

  const existing = await findRatingByRideAndDirection(rideId, 'PASSENGER_TO_DRIVER');
  if (existing) {
    throw new ConflictError('You have already rated this ride');
  }

  const driverProfile = await findDriverProfileById(ride.driverId);
  if (!driverProfile) {
    // Unreachable in practice (driver_id is a foreign key that can't
    // dangle), but fail loudly rather than silently mis-rating no one.
    throw new Error(`Driver profile ${ride.driverId} not found for completed ride ${rideId}`);
  }

  const rating = await createRating({
    rideId,
    raterUserId: userId,
    rateeUserId: driverProfile.userId,
    direction: 'PASSENGER_TO_DRIVER',
    stars: input.stars,
    comment: input.comment ?? null,
  });

  // Aggregate ratings server-side (section 13): a full recompute over
  // every rating this driver has ever received, not an incremental
  // running average — see ratingsRepository.sumRatingsForRatee.
  const aggregate = await sumRatingsForRatee(driverProfile.userId);
  await updateDriverRatingAggregate(driverProfile.id, aggregate);

  return toRating(rating);
}

/**
 * Section 13: "Driver rates Passenger." Mirrors
 * submitPassengerToDriverRating exactly, direction reversed.
 */
export async function submitDriverToPassengerRating(
  rideId: string,
  userId: string,
  input: SubmitRatingInput,
): Promise<Rating> {
  const driver = await findDriverProfileByUserId(userId);
  if (!driver) throw new Error('Driver profile not found for authenticated driver user');

  const ride = await findRideById(rideId);
  if (!ride || ride.driverId !== driver.id) {
    throw new NotFoundError('Ride not found');
  }
  if (ride.status !== 'COMPLETED') {
    throw new ConflictError('Ratings are unavailable before ride completion');
  }

  const existing = await findRatingByRideAndDirection(rideId, 'DRIVER_TO_PASSENGER');
  if (existing) {
    throw new ConflictError('You have already rated this ride');
  }

  const passengerProfile = await findPassengerProfileById(ride.passengerId);
  if (!passengerProfile) {
    throw new Error(`Passenger profile ${ride.passengerId} not found for completed ride ${rideId}`);
  }

  const rating = await createRating({
    rideId,
    raterUserId: userId,
    rateeUserId: passengerProfile.userId,
    direction: 'DRIVER_TO_PASSENGER',
    stars: input.stars,
    comment: input.comment ?? null,
  });

  const aggregate = await sumRatingsForRatee(passengerProfile.userId);
  await updatePassengerRatingAggregate(passengerProfile.id, aggregate);

  return toRating(rating);
}

/** Read access, gated to the ride's own passenger or driver — same
 * not-found-not-forbidden treatment as everywhere else in this codebase
 * for a mismatched caller: a ride that doesn't exist and a ride that
 * isn't the caller's both surface as 404. */
export async function getRatingsForRide(
  rideId: string,
  userId: string,
  role: 'PASSENGER' | 'DRIVER',
): Promise<RideRatings> {
  const ride = await findRideById(rideId);
  if (!ride) throw new NotFoundError('Ride not found');

  if (role === 'PASSENGER') {
    const passenger = await findPassengerProfileByUserId(userId);
    if (!passenger || ride.passengerId !== passenger.id) {
      throw new NotFoundError('Ride not found');
    }
  } else {
    const driver = await findDriverProfileByUserId(userId);
    if (!driver || ride.driverId !== driver.id) {
      throw new NotFoundError('Ride not found');
    }
  }

  const rows = await findRatingsForRide(rideId);
  const passengerToDriver = rows.find((row) => row.direction === 'PASSENGER_TO_DRIVER');
  const driverToPassenger = rows.find((row) => row.direction === 'DRIVER_TO_PASSENGER');

  return {
    passengerToDriver: passengerToDriver ? toRating(passengerToDriver) : null,
    driverToPassenger: driverToPassenger ? toRating(driverToPassenger) : null,
  };
}
