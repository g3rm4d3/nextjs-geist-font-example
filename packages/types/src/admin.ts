/**
 * Admin App API contracts (Phase 14), shared by apps/api (producer) and
 * apps/admin-app (consumer). Mirrors @rideshare/database's shapes by
 * hand rather than importing them — this package stays dependency-free
 * on purpose (see docs/architecture.md).
 */
import type { DriverAvailabilityStatus, DriverOnboardingStatus } from './auth';
import type { BackgroundCheckSummary, DocumentReviewStatus, DocumentType } from './document';
import type { Vehicle } from './driver';
import type { PaymentStatus } from './payment';
import type { RatingDirection } from './rating';
import type { NamedLocation, RideStatus } from './ride';

/** Section 14's "Dashboard" — one-call summary of everything else. */
export interface AdminDashboardSummary {
  totalPassengers: number;
  totalDrivers: number;
  pendingDriverApplications: number;
  pendingDocuments: number;
  /** Phase 15's "internal expiration warnings" — APPROVED documents
   * expiring within the next 30 days. */
  expiringDocumentsCount: number;
  activeRideCount: number;
  openSupportTicketCount: number;
  todayRideCount: number;
  todayPlatformCommissionCents: number;
}

export interface AdminPassengerSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  averageRating: number | null;
  ratingsCount: number;
  createdAt: string;
}

/** "Inspect passenger." */
export interface AdminPassengerDetail extends AdminPassengerSummary {
  totalRides: number;
  defaultTestPaymentMethodId: string | null;
}

export interface AdminDriverSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  onboardingStatus: DriverOnboardingStatus;
  availabilityStatus: DriverAvailabilityStatus;
  averageRating: number | null;
  ratingsCount: number;
  totalRides: number;
  createdAt: string;
}

export interface AdminDocumentSummary {
  id: string;
  driverId: string;
  driverName: string;
  documentType: DocumentType;
  reviewStatus: DocumentReviewStatus;
  uploadedAt: string;
  expiresAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface AdminDriverDetail extends AdminDriverSummary {
  licenseNumber: string;
  licenseState: string;
  licenseExpiresAt: string | null;
  vehicle: Vehicle | null;
  documents: AdminDocumentSummary[];
  /** Phase 15's BackgroundCheckProvider result, most recent run only —
   * null until an admin has triggered at least one check. */
  latestBackgroundCheck: BackgroundCheckSummary | null;
}

export interface AdminVehicleSummary {
  id: string;
  driverId: string;
  driverName: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  isActive: boolean;
}

export interface AdminRideSummary {
  id: string;
  status: RideStatus;
  passengerName: string;
  driverName: string | null;
  requestedAt: string;
  completedAt: string | null;
  finalFareCents: number | null;
}

/** "Inspect ride." */
export interface AdminRideDetail extends AdminRideSummary {
  pickup: NamedLocation;
  destination: NamedLocation;
  estimatedFareCents: number | null;
  actualDistanceMeters: number | null;
  actualDurationSeconds: number | null;
  cancelledAt: string | null;
  cancelledBy: 'PASSENGER' | 'DRIVER' | 'SYSTEM' | null;
  cancellationReason: string | null;
  /** Section 17's "record potential TEST fee" — null unless this ride
   * was terminally cancelled with a fee applicable (see
   * docs/cancellation.md's rule); a driver cancellation that returned
   * the ride to matching instead of terminating it never sets this. */
  cancellationFeeCents: number | null;
}

export interface AdminPaymentSummary {
  id: string;
  rideId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  passengerName: string;
  createdAt: string;
}

/** "Inspect payment." Provider-safe only — no card data ever appears here. */
export interface AdminPaymentDetail extends AdminPaymentSummary {
  providerPaymentIntentId: string | null;
  failureReason: string | null;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface AdminRatingSummary {
  id: string;
  rideId: string;
  direction: RatingDirection;
  stars: number;
  comment: string | null;
  raterName: string;
  rateeName: string;
  createdAt: string;
}

export type AdminSupportTicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_USER'
  | 'RESOLVED'
  | 'CLOSED';

export interface AdminSupportTicketSummary {
  id: string;
  userName: string;
  subject: string;
  status: AdminSupportTicketStatus;
  rideId: string | null;
  createdAt: string;
}

export interface AdminSupportMessage {
  id: string;
  authorName: string | null;
  isInternalNote: boolean;
  body: string;
  createdAt: string;
}

export interface AdminSupportTicketDetail extends AdminSupportTicketSummary {
  messages: AdminSupportMessage[];
}

export interface AdminPricingConfig {
  id: string;
  name: string;
  baseFareCents: number;
  perMileRateCents: number;
  perMinuteRateCents: number;
  minimumFareCents: number;
  bookingFeeCents: number;
  cancellationFeeCents: number;
  platformCommissionPercentage: number;
  active: boolean;
  effectiveAt: string;
  createdAt: string;
}

export interface AdminSystemSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Append-only, section 14: "Sensitive admin operations generate audit
 * records." `before`/`after` are opaque JSON snapshots — shape depends
 * on `entityType`, deliberately not modeled further here. */
export interface AdminAuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

/** Platform-wide earnings broken out by driver — the per-driver
 * drill-down docs/financial-ledger.md (Phase 12) deferred to this phase. */
export interface AdminDriverEarningsRow {
  driverId: string;
  driverName: string;
  rideCount: number;
  grossFareCents: number;
  platformCommissionCents: number;
  driverGrossEarningsCents: number;
}
