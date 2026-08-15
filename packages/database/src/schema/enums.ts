import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * All enums as native Postgres enum types (not free-text columns), so
 * invalid values are rejected at the database level regardless of which
 * application wrote the row. Application-level state-machine rules (which
 * *transitions* are legal, not just which raw values exist) are enforced
 * in code — see docs/ride-state-machine.md in a later phase.
 */

// Section 8 — user roles.
export const userRoleEnum = pgEnum('user_role', ['PASSENGER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN']);

// Section 9 — driver approval/onboarding status. Deliberately separate
// from operational availability below.
export const driverOnboardingStatusEnum = pgEnum('driver_onboarding_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);

// Section 9 — operational availability. A driver can only reach ONLINE if
// onboarding_status = APPROVED; enforced by a CHECK constraint on
// driver_profiles (see drivers.ts), not by conflating the two concepts.
export const driverAvailabilityStatusEnum = pgEnum('driver_availability_status', [
  'OFFLINE',
  'ONLINE',
  'BUSY',
]);

export const vehicleStatusEnum = pgEnum('vehicle_status', ['ACTIVE', 'INACTIVE']);

// Phase 15 — driver document management.
export const documentTypeEnum = pgEnum('document_type', [
  'DRIVER_LICENSE',
  'VEHICLE_REGISTRATION',
  'INSURANCE',
  'PROFILE_PHOTO',
]);

// REPLACEMENT_REQUESTED added in Phase 15: distinct from REJECTED — the
// document isn't being turned down outright (e.g. it's fine but about to
// expire, or the photo needs a fresh copy), it just needs a new upload.
export const documentReviewStatusEnum = pgEnum('document_review_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REPLACEMENT_REQUESTED',
]);

// Phase 15 — BackgroundCheckProvider is MOCK ONLY in Stage 1 (section 13);
// modeled as PENDING/PASSED/FAILED so a real, async provider could be
// swapped in later without a schema change.
export const backgroundCheckStatusEnum = pgEnum('background_check_status', [
  'PENDING',
  'PASSED',
  'FAILED',
]);

// Section 12 — ride lifecycle state machine (valid states only; legal
// transitions are enforced in application code in Phase 9).
export const rideStatusEnum = pgEnum('ride_status', [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'PASSENGER_ONBOARD',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
]);

export const cancelledByActorEnum = pgEnum('cancelled_by_actor', ['PASSENGER', 'DRIVER', 'SYSTEM']);

// Phase 8 — per-driver offers generated during matching, distinct from the
// ride itself (one ride can generate many ride_requests as candidates are
// tried in sequence).
export const rideRequestStatusEnum = pgEnum('ride_request_status', [
  'OFFERED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
]);

export const rideEventActorTypeEnum = pgEnum('ride_event_actor_type', [
  'PASSENGER',
  'DRIVER',
  'SYSTEM',
  'ADMIN',
]);

// Phase 13 — ratings are directional (passenger rates driver, and
// separately driver rates passenger) for the same ride.
export const ratingDirectionEnum = pgEnum('rating_direction', [
  'PASSENGER_TO_DRIVER',
  'DRIVER_TO_PASSENGER',
]);

// Phase 11 — payment sandbox (Stripe TEST MODE only).
export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
]);

// Phase 12 — payout status is a placeholder; no real payouts in Stage 1.
export const payoutStatusEnum = pgEnum('payout_status', ['PENDING', 'PAID']);

// Phase 18 — support ticket lifecycle.
export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
]);

// Table exists per the core domain list (section 11); promo code
// *redemption logic* is explicitly a "do not implement yet" feature — see
// docs/database.md.
export const promoDiscountTypeEnum = pgEnum('promo_discount_type', ['PERCENTAGE', 'FIXED_AMOUNT']);
