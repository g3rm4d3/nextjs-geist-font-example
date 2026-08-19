import type {
  ApiResponse,
  AppNotification,
  AuthResponse,
  AuthUser,
  DriverDocument,
  DriverEarningsHistoryEntry,
  DriverEarningsSummary,
  DriverProfileSummary,
  Rating,
  RecordLocationResult,
  Ride,
  RideOffer,
  RideRatings,
  SupportTicket,
  SupportTicketDetail,
  Vehicle,
} from '@rideshare/types';
import type {
  CreateSupportTicketInput,
  DriverLocationPingInput,
  LoginInput,
  RegisterDriverInput,
  RegisterPushTokenInput,
  SubmitRatingInput,
  UpdateAvailabilityInput,
  UploadDocumentInput,
  UpsertVehicleInput,
} from '@rideshare/validation';
import { env } from '../config/env';

/**
 * Thrown for any non-2xx response. Carries the server's stable error
 * `code` (e.g. "VALIDATION_ERROR", "FORBIDDEN") so screens can branch on
 * it instead of matching on message text.
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new ApiClientError(json.error.code, json.error.message, json.error.details);
  }

  return json.data;
}

export function registerDriver(input: RegisterDriverInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/drivers/register', { body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { body: input });
}

export function refresh(refreshToken: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/refresh', { body: { refreshToken } });
}

export function logout(refreshToken: string): Promise<{ loggedOut: boolean }> {
  return request<{ loggedOut: boolean }>('/auth/logout', { body: { refreshToken } });
}

export function getMe(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/me', { method: 'GET', accessToken });
}

export function getDriverProfile(accessToken: string): Promise<DriverProfileSummary> {
  return request<DriverProfileSummary>('/drivers/me/profile', { method: 'GET', accessToken });
}

export function upsertVehicle(accessToken: string, input: UpsertVehicleInput): Promise<Vehicle> {
  return request<Vehicle>('/drivers/me/vehicle', { method: 'PUT', body: input, accessToken });
}

export function submitApplication(accessToken: string): Promise<DriverProfileSummary> {
  return request<DriverProfileSummary>('/drivers/me/submit-application', { accessToken });
}

export function setAvailability(
  accessToken: string,
  input: UpdateAvailabilityInput,
): Promise<DriverProfileSummary> {
  return request<DriverProfileSummary>('/drivers/me/availability', {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

export function reportLocation(
  accessToken: string,
  input: DriverLocationPingInput,
): Promise<RecordLocationResult> {
  return request<RecordLocationResult>('/drivers/me/location', { body: input, accessToken });
}

/**
 * Phase 8: polled from DriverHomeMapScreen while ONLINE. `null` (not a
 * 404) is the normal "nothing right now" response — see
 * matchingService.getCurrentOffer on the API side.
 */
export function getCurrentOffer(accessToken: string): Promise<RideOffer | null> {
  return request<RideOffer | null>('/drivers/me/offer', { method: 'GET', accessToken });
}

export function acceptOffer(accessToken: string, rideRequestId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/offer/${rideRequestId}/accept`, { accessToken });
}

export function declineOffer(
  accessToken: string,
  rideRequestId: string,
): Promise<{ declined: boolean }> {
  return request<{ declined: boolean }>(`/drivers/me/offer/${rideRequestId}/decline`, {
    accessToken,
  });
}

/**
 * Phase 9: the strict driver-driven forward lifecycle, one function per
 * transition — see docs/ride-lifecycle.md. Each returns the updated
 * Ride so callers can hand it straight to ActiveRideContext.setRide.
 */
export function markEnRoute(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/en-route`, { accessToken });
}

export function markArrived(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/arrived`, { accessToken });
}

export function markPassengerOnboard(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/picked-up`, { accessToken });
}

export function startTrip(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/start`, { accessToken });
}

export function completeRide(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/complete`, { accessToken });
}

export function cancelRideAsDriver(
  accessToken: string,
  rideId: string,
  reason?: string,
): Promise<Ride> {
  return request<Ride>(`/drivers/me/rides/${rideId}/cancel`, {
    body: reason ? { reason } : {},
    accessToken,
  });
}

/** Phase 12: "Driver sees: Today / Week / Month." */
export function getEarningsSummary(accessToken: string): Promise<DriverEarningsSummary> {
  return request<DriverEarningsSummary>('/drivers/me/earnings/summary', {
    method: 'GET',
    accessToken,
  });
}

/** Phase 12: "Driver sees: ... Ride history." */
export function getEarningsHistory(accessToken: string): Promise<DriverEarningsHistoryEntry[]> {
  return request<DriverEarningsHistoryEntry[]>('/drivers/me/earnings/history', {
    method: 'GET',
    accessToken,
  });
}

/** Phase 13: "Driver rates Passenger." Only legal once the ride is
 * COMPLETED — see RideCompleteScreen. */
export function submitPassengerRating(
  accessToken: string,
  rideId: string,
  input: SubmitRatingInput,
): Promise<Rating> {
  return request<Rating>(`/drivers/me/rides/${rideId}/rating`, { body: input, accessToken });
}

export function getRideRatings(accessToken: string, rideId: string): Promise<RideRatings> {
  return request<RideRatings>(`/drivers/me/rides/${rideId}/ratings`, {
    method: 'GET',
    accessToken,
  });
}

/** Phase 15: "Implement secure document system" — a driver's own upload. */
export function uploadDocument(
  accessToken: string,
  input: UploadDocumentInput,
): Promise<DriverDocument> {
  return request<DriverDocument>('/drivers/me/documents', { body: input, accessToken });
}

export function getOwnDocuments(accessToken: string): Promise<DriverDocument[]> {
  return request<DriverDocument[]>('/drivers/me/documents', { method: 'GET', accessToken });
}

/** Section 16: a driver's own in-app notification list, most recent
 * first, plus an unread badge count. See NotificationsScreen. */
export interface NotificationListResult {
  notifications: AppNotification[];
  unreadCount: number;
}

export function getNotifications(accessToken: string): Promise<NotificationListResult> {
  return request<NotificationListResult>('/notifications', { method: 'GET', accessToken });
}

export function markNotificationRead(
  accessToken: string,
  notificationId: string,
): Promise<AppNotification> {
  return request<AppNotification>(`/notifications/${notificationId}/read`, { accessToken });
}

export function markAllNotificationsRead(accessToken: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/notifications/read-all', { accessToken });
}

/** Best-effort device registration — see lib/pushNotifications.ts for
 * why a null/failed token never reaches this call at all. */
export function registerPushToken(
  accessToken: string,
  input: RegisterPushTokenInput,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/notifications/push-token', { body: input, accessToken });
}

export function unregisterPushToken(accessToken: string, token: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/notifications/push-token?token=${encodeURIComponent(token)}`, {
    method: 'DELETE',
    accessToken,
  });
}

/** Section 18: "create support ticket. Ticket can reference ride." Same
 * endpoints as passenger-app — a support ticket isn't a driver- or
 * passenger-specific resource, just one owned by whichever authenticated
 * user created it. */
export function createSupportTicket(
  accessToken: string,
  input: CreateSupportTicketInput,
): Promise<SupportTicketDetail> {
  return request<SupportTicketDetail>('/support/tickets', { body: input, accessToken });
}

export function getSupportTickets(accessToken: string): Promise<SupportTicket[]> {
  return request<SupportTicket[]>('/support/tickets', { method: 'GET', accessToken });
}

export function getSupportTicket(accessToken: string, ticketId: string): Promise<SupportTicketDetail> {
  return request<SupportTicketDetail>(`/support/tickets/${ticketId}`, { method: 'GET', accessToken });
}
