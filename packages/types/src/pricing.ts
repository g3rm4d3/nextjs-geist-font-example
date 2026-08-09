/**
 * Fare estimate API contract, shared by apps/api (producer) and any
 * client (consumer). Mirrors @rideshare/pricing's FareBreakdown by hand
 * rather than importing it — this package stays dependency-free on
 * purpose (see docs/architecture.md). Keep in sync if that shape changes.
 */
export interface FareEstimate {
  baseFareCents: number;
  distanceFareCents: number;
  timeFareCents: number;
  bookingFeeCents: number;
  subtotalCents: number;
  minimumFareCents: number;
  minimumFareApplied: boolean;
  totalCents: number;
  platformCommissionCents: number;
  driverEarningsCents: number;
}
