import type { ApiResponse, HealthCheckResponse } from '@rideshare/types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Thin fetch wrapper for the admin app. Kept intentionally small in
 * Phase 0 — grows into a typed client per domain endpoint as later phases
 * add real admin functionality (drivers, rides, payments, ...).
 */
export async function fetchApiHealth(): Promise<ApiResponse<HealthCheckResponse>> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
  return (await response.json()) as ApiResponse<HealthCheckResponse>;
}
