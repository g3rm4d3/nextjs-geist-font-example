import type {
  ApiResponse,
  AuthResponse,
  AuthUser,
  DriverProfileSummary,
  Vehicle,
} from '@rideshare/types';
import type {
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
