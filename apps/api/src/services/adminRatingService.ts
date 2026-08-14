import type { AdminRatingSummary } from '@rideshare/types';
import { listRecentRatingsForAdmin, type RatingAdminRow } from '../repositories/ratingsRepository';

function toSummary(row: RatingAdminRow): AdminRatingSummary {
  const passengerName = `${row.passengerFirstName} ${row.passengerLastName}`;
  const driverName =
    row.driverFirstName && row.driverLastName ? `${row.driverFirstName} ${row.driverLastName}` : 'Unknown driver';

  const isPassengerRater = row.direction === 'PASSENGER_TO_DRIVER';

  return {
    id: row.id,
    rideId: row.rideId,
    direction: row.direction,
    stars: row.stars,
    comment: row.comment,
    raterName: isPassengerRater ? passengerName : driverName,
    rateeName: isPassengerRater ? driverName : passengerName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Section 14's "Ratings" — every rating across every ride, both
 * directions, newest first. Read-only: nothing in Stage 1 lets an admin
 * edit or remove a rating (no moderation flow yet — see docs/ratings.md's
 * own known limitations). */
export async function listRatings(): Promise<AdminRatingSummary[]> {
  const rows = await listRecentRatingsForAdmin();
  return rows.map(toSummary);
}
