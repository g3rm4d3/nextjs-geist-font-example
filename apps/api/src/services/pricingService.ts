import type { Coordinate, RoutePreview } from '@rideshare/maps';
import { calculateFare, type FareBreakdown, type PricingConfig } from '@rideshare/pricing';
import { routeProvider } from '../lib/mapProvider';
import { findActivePricingConfig } from '../repositories/pricingConfigsRepository';

export interface FareEstimateWithRoute {
  route: RoutePreview;
  fare: FareBreakdown;
}

/**
 * Fully server-authoritative: takes raw origin/destination coordinates,
 * not a client-supplied distance/duration. If a client could hand us
 * "distanceMeters: 1, durationSeconds: 0" directly, the per-mile/per-
 * minute math being server-side wouldn't matter — the inputs to that
 * math would still be client-trusted. Recomputing the route here closes
 * that gap the same way Phase 7's ride request service does (section 3:
 * never trust client-provided fare inputs).
 *
 * Returns the route alongside the fare — rideService (Phase 7) needs
 * both (distance/duration to store on the ride, the fare to quote), and
 * computing them separately would mean loading the pricing config and
 * calling routeProvider twice for the same request.
 */
async function loadActivePricingConfig(): Promise<PricingConfig> {
  const configRow = await findActivePricingConfig();
  if (!configRow) {
    // Genuine misconfiguration (no active pricing_configs row) — Phase 1's
    // seed always creates one, so this should only happen against a
    // migrated-but-unseeded or misconfigured database. Not a client error.
    throw new Error('No active pricing configuration found');
  }

  return {
    baseFareCents: configRow.baseFareCents,
    perMileRateCents: configRow.perMileRateCents,
    perMinuteRateCents: configRow.perMinuteRateCents,
    minimumFareCents: configRow.minimumFareCents,
    bookingFeeCents: configRow.bookingFeeCents,
    // Drizzle returns `numeric` columns as strings to avoid precision
    // loss on values too large for a JS number — safe to convert here
    // since this column is constrained to [0, 100] with 2 decimal places.
    platformCommissionPercentage: Number(configRow.platformCommissionPercentage),
  };
}

export async function getFareEstimateWithRoute(
  origin: Coordinate,
  destination: Coordinate,
): Promise<FareEstimateWithRoute> {
  const config = await loadActivePricingConfig();
  const route = await routeProvider.getRoute(origin, destination);
  const fare = calculateFare(route, config);
  return { route, fare };
}

export async function getFareEstimate(
  origin: Coordinate,
  destination: Coordinate,
): Promise<FareBreakdown> {
  const { fare } = await getFareEstimateWithRoute(origin, destination);
  return fare;
}

/**
 * Phase 9: the ride's *final* fare at COMPLETED, computed the same
 * server-authoritative way as the estimate (section 3) but from the
 * trip's actual distance/duration rather than the pre-trip route
 * preview — see rideLifecycleService.completeRide for what "actual"
 * means in a Stage 1 with no live route tracking.
 */
export async function getFareForActualTrip(
  distanceMeters: number,
  durationSeconds: number,
): Promise<FareBreakdown> {
  const config = await loadActivePricingConfig();
  return calculateFare({ distanceMeters, durationSeconds }, config);
}
