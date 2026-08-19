/**
 * Notification API contracts (Phase 16), shared by apps/api (producer)
 * and apps/passenger-app / apps/driver-app (consumers).
 */

/**
 * Section 16's canonical event list. A dotted `domain.event` key,
 * mirroring the audit log's `action` naming convention
 * (docs/admin-application.md) — stable and machine-matchable, never
 * inferred from a notification's (translatable, editable) title/body
 * text.
 */
export type NotificationType =
  | 'ride.requested'
  | 'ride.accepted'
  | 'ride.driver_approaching'
  | 'ride.driver_arrived'
  | 'ride.started'
  | 'ride.completed'
  | 'payment.status'
  | 'driver.approved'
  | 'driver.rejected'
  | 'document.expiring'
  | 'support.update';

/** One in-app notification, as returned to the owning user. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Opaque per-event payload (e.g. `{ rideId }`) for deep-linking —
   * shape depends on `type`, deliberately not modeled further here. */
  data: unknown;
  readAt: string | null;
  createdAt: string;
}
