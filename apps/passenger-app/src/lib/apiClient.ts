import type { ApiResponse, AuthResponse, AuthUser, FareEstimate } from '@rideshare/types';
import type { RoutePreview } from '@rideshare/maps';
import type { LoginInput, RegisterPassengerInput, RoutePreviewInput } from '@rideshare/validation';
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
