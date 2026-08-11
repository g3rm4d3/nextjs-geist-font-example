import type {
  ApiResponse,
  AssignedRideDriverInfo,
  AuthResponse,
  AuthUser,
  FareEstimate,
  Ride,
} from '@rideshare/types';
import type { RoutePreview } from '@rideshare/maps';
import type {
  CreateRideRequestInput,
  LoginInput,
  RegisterPassengerInput,
  RoutePreviewInput,
} from '@rideshare/validation';
import { env } from '../config/env';

/**
 * Thrown for any non-2xx response. Carries the server's stable error
 * `code` (e.g. "VALIDATION_ERROR", "CONFLICT") so screens can branch on
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

export function registerPassenger(input: RegisterPassengerInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/passengers/register', { body: input });
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

export function previewRoute(accessToken: string, input: RoutePreviewInput): Promise<RoutePreview> {
  return request<RoutePreview>('/routes/preview', { body: input, accessToken });
}

export function getFareEstimate(
  accessToken: string,
  input: RoutePreviewInput,
): Promise<FareEstimate> {
  return request<FareEstimate>('/pricing/estimate', { body: input, accessToken });
}

export function createRideRequest(
  accessToken: string,
  input: CreateRideRequestInput,
): Promise<Ride> {
  return request<Ride>('/rides', { body: input, accessToken });
}

/**
 * Phase 9: the one passenger-facing state-changing action — only legal
 * up through DRIVER_ARRIVED server-side (rideLifecycleService), a 409
 * past that point.
 */
export function cancelRide(accessToken: string, rideId: string, reason?: string): Promise<Ride> {
  return request<Ride>(`/rides/${rideId}/cancel`, {
    body: reason ? { reason } : {},
    accessToken,
  });
}

/** Phase 9/10: the ride's current authoritative state — polled by
 * SearchingDriver/DriverAssigned/RideTracking to learn about status
 * changes made from the driver side. */
export function getRide(accessToken: string, rideId: string): Promise<Ride> {
  return request<Ride>(`/rides/${rideId}`, { method: 'GET', accessToken });
}

/**
 * Phase 10: `null` (not a 404) whenever there's nothing to show yet or
 * anymore — see rideTrackingService.getAssignedDriverInfo on the API
 * side for exactly when that is.
 */
export function getAssignedDriver(
  accessToken: string,
  rideId: string,
): Promise<AssignedRideDriverInfo | null> {
  return request<AssignedRideDriverInfo | null>(`/rides/${rideId}/driver`, {
    method: 'GET',
    accessToken,
  });
}
