import type {
  ApiResponse,
  AuthResponse,
  AuthUser,
  DriverEarningsHistoryEntry,
  DriverEarningsSummary,
  DriverProfileSummary,
  RecordLocationResult,
  Ride,
  RideOffer,
  Vehicle,
} from '@rideshare/types';
import type {
  DriverLocationPingInput,
  LoginInput,
  RegisterDriverInput,
  UpdateAvailabilityInput,
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
