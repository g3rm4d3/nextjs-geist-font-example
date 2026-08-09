import type {
  ApiResponse,
  AuthResponse,
  AuthUser,
  FleetDriverLocation,
  HealthCheckResponse,
} from '@rideshare/types';
import type { LoginInput } from '@rideshare/validation';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Thrown for any non-2xx response from the unwrapped `request` helper
 * below — mirrors apps/passenger-app and apps/driver-app's ApiClientError
 * so error-branching logic stays consistent across all three apps.
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new ApiClientError(json.error.code, json.error.message, json.error.details);
  }

  return json.data;
}

/**
 * Kept as its own function returning the raw envelope (not unwrapped
 * via `request`) — SystemStatusCard (Phase 0) branches on
 * `response.success` itself rather than catching a thrown error, and
 * changing that isn't this phase's job.
 */
export async function fetchApiHealth(): Promise<ApiResponse<HealthCheckResponse>> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
  return (await response.json()) as ApiResponse<HealthCheckResponse>;
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { body: input });
}

export function getMe(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/me', { method: 'GET', accessToken });
}

/** Phase 6: "Admin App should display virtual drivers on map." */
export function getFleetLocations(accessToken: string): Promise<FleetDriverLocation[]> {
  return request<FleetDriverLocation[]>('/admin/drivers/locations', {
    method: 'GET',
    accessToken,
  });
}
