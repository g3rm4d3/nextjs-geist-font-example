import type {
  AdminActiveRide,
  AdminAuditLogEntry,
  AdminDashboardSummary,
  AdminDocumentSummary,
  AdminDriverDetail,
  AdminDriverEarningsRow,
  AdminDriverSummary,
  AdminPassengerDetail,
  AdminPassengerSummary,
  AdminPaymentDetail,
  AdminPaymentSummary,
  AdminPricingConfig,
  AdminRatingSummary,
  AdminRideDetail,
  AdminRideSummary,
  AdminSupportTicketDetail,
  AdminSupportTicketSummary,
  AdminSystemSetting,
  AdminVehicleSummary,
  ApiResponse,
  AuthResponse,
  AuthUser,
  FleetDriverLocation,
  HealthCheckResponse,
  PlatformRevenueSummary,
} from '@rideshare/types';
import type {
  ChangePricingInput,
  LoginInput,
  ReviewDocumentInput,
  UpsertSystemSettingInput,
} from '@rideshare/validation';

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

/** Phase 10: "Admin: show active rides." */
export function getActiveRides(accessToken: string): Promise<AdminActiveRide[]> {
  return request<AdminActiveRide[]>('/admin/rides/active', {
    method: 'GET',
    accessToken,
  });
}

/** Phase 12: "Admin sees platform test revenue." */
export function getPlatformRevenue(accessToken: string): Promise<PlatformRevenueSummary> {
  return request<PlatformRevenueSummary>('/admin/revenue', {
    method: 'GET',
    accessToken,
  });
}

// ---------------------------------------------------------------------
// Phase 14: Admin Application
// ---------------------------------------------------------------------

/** Section 14's "Passengers." */
export function listAdminPassengers(accessToken: string): Promise<AdminPassengerSummary[]> {
  return request<AdminPassengerSummary[]>('/admin/passengers', { method: 'GET', accessToken });
}

/** "Inspect passenger." */
export function getAdminPassenger(accessToken: string, passengerId: string): Promise<AdminPassengerDetail> {
  return request<AdminPassengerDetail>(`/admin/passengers/${passengerId}`, {
    method: 'GET',
    accessToken,
  });
}

/** Section 14's "Drivers" / "Driver Applications" — the latter is just
 * this list filtered to PENDING_REVIEW, same as the backend. */
export function listAdminDrivers(
  accessToken: string,
  onboardingStatus?: AdminDriverSummary['onboardingStatus'],
): Promise<AdminDriverSummary[]> {
  const query = onboardingStatus ? `?onboardingStatus=${onboardingStatus}` : '';
  return request<AdminDriverSummary[]>(`/admin/drivers${query}`, { method: 'GET', accessToken });
}

/** "Inspect driver." */
export function getAdminDriver(accessToken: string, driverId: string): Promise<AdminDriverDetail> {
  return request<AdminDriverDetail>(`/admin/drivers/${driverId}`, { method: 'GET', accessToken });
}

/** "Approve driver" — any admin. */
export function approveDriver(accessToken: string, driverId: string): Promise<AdminDriverSummary> {
  return request<AdminDriverSummary>(`/admin/drivers/${driverId}/approve`, { accessToken });
}

/** "Reject driver" — any admin, reason required. */
export function rejectDriver(
  accessToken: string,
  driverId: string,
  reason: string,
): Promise<AdminDriverSummary> {
  return request<AdminDriverSummary>(`/admin/drivers/${driverId}/reject`, {
    accessToken,
    body: { reason },
  });
}

/** "Suspend driver" — SUPER_ADMIN only (enforced server-side; the API
 * returns 403 for a plain ADMIN token regardless of what this client
 * sends). */
export function suspendDriver(
  accessToken: string,
  driverId: string,
  reason: string,
): Promise<AdminDriverSummary> {
  return request<AdminDriverSummary>(`/admin/drivers/${driverId}/suspend`, {
    accessToken,
    body: { reason },
  });
}

/** "Reactivate driver" — SUPER_ADMIN only, same as suspend. */
export function reactivateDriver(accessToken: string, driverId: string): Promise<AdminDriverSummary> {
  return request<AdminDriverSummary>(`/admin/drivers/${driverId}/reactivate`, { accessToken });
}

/** Section 14's "Vehicles" — read-only. */
export function listAdminVehicles(accessToken: string): Promise<AdminVehicleSummary[]> {
  return request<AdminVehicleSummary[]>('/admin/vehicles', { method: 'GET', accessToken });
}

/** Section 14's "Documents" review queue. */
export function listAdminDocuments(
  accessToken: string,
  reviewStatus?: AdminDocumentSummary['reviewStatus'],
): Promise<AdminDocumentSummary[]> {
  const query = reviewStatus ? `?reviewStatus=${reviewStatus}` : '';
  return request<AdminDocumentSummary[]>(`/admin/documents${query}`, { method: 'GET', accessToken });
}

/** "Review documents" — approve outright, or reject with a required reason. */
export function reviewDocument(
  accessToken: string,
  documentId: string,
  input: ReviewDocumentInput,
): Promise<AdminDocumentSummary> {
  return request<AdminDocumentSummary>(`/admin/documents/${documentId}/review`, {
    accessToken,
    body: input,
  });
}

/** Section 14's "Rides" — full ride history, distinct from Phase 10's
 * GET /admin/rides/active (getActiveRides above). */
export function listAdminRides(
  accessToken: string,
  statusFilter?: AdminRideSummary['status'],
): Promise<AdminRideSummary[]> {
  const query = statusFilter ? `?status=${statusFilter}` : '';
  return request<AdminRideSummary[]>(`/admin/rides${query}`, { method: 'GET', accessToken });
}

/** "Inspect ride." */
export function getAdminRide(accessToken: string, rideId: string): Promise<AdminRideDetail> {
  return request<AdminRideDetail>(`/admin/rides/${rideId}`, { method: 'GET', accessToken });
}

/** Section 14's "Payments." */
export function listAdminPayments(
  accessToken: string,
  statusFilter?: AdminPaymentSummary['status'],
): Promise<AdminPaymentSummary[]> {
  const query = statusFilter ? `?status=${statusFilter}` : '';
  return request<AdminPaymentSummary[]>(`/admin/payments${query}`, { method: 'GET', accessToken });
}

/** "Inspect payment." */
export function getAdminPayment(accessToken: string, paymentId: string): Promise<AdminPaymentDetail> {
  return request<AdminPaymentDetail>(`/admin/payments/${paymentId}`, { method: 'GET', accessToken });
}

/** Section 14's "Ratings" — every rating across every ride, read-only. */
export function listAdminRatings(accessToken: string): Promise<AdminRatingSummary[]> {
  return request<AdminRatingSummary[]>('/admin/ratings', { method: 'GET', accessToken });
}

/** Section 14's "Support" ticket list. */
export function listAdminSupportTickets(accessToken: string): Promise<AdminSupportTicketSummary[]> {
  return request<AdminSupportTicketSummary[]>('/admin/support/tickets', { method: 'GET', accessToken });
}

/** "Inspect" a support ticket — the full message thread. */
export function getAdminSupportTicket(
  accessToken: string,
  ticketId: string,
): Promise<AdminSupportTicketDetail> {
  return request<AdminSupportTicketDetail>(`/admin/support/tickets/${ticketId}`, {
    method: 'GET',
    accessToken,
  });
}

/** Section 14's "Pricing" — full version history, any admin can view. */
export function listAdminPricingConfigs(accessToken: string): Promise<AdminPricingConfig[]> {
  return request<AdminPricingConfig[]>('/admin/pricing/configs', { method: 'GET', accessToken });
}

/** "Change pricing" — SUPER_ADMIN only server-side. */
export function changePricing(
  accessToken: string,
  input: ChangePricingInput,
): Promise<AdminPricingConfig> {
  return request<AdminPricingConfig>('/admin/pricing/configs', { accessToken, body: input });
}

/** Section 14's "System Settings" — any admin can view. */
export function listAdminSettings(accessToken: string): Promise<AdminSystemSetting[]> {
  return request<AdminSystemSetting[]>('/admin/settings', { method: 'GET', accessToken });
}

/** Writing a setting is SUPER_ADMIN only server-side. */
export function upsertAdminSetting(
  accessToken: string,
  key: string,
  input: UpsertSystemSettingInput,
): Promise<AdminSystemSetting> {
  return request<AdminSystemSetting>(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    accessToken,
    body: input,
  });
}

/** Section 14's "Dashboard" — one-call summary. */
export function getAdminDashboard(accessToken: string): Promise<AdminDashboardSummary> {
  return request<AdminDashboardSummary>('/admin/dashboard', { method: 'GET', accessToken });
}

/** Section 14's "Earnings" per-driver breakdown — additive to Phase 12's
 * platform-wide GET /admin/revenue (getPlatformRevenue above). */
export function listAdminDriverEarnings(accessToken: string): Promise<AdminDriverEarningsRow[]> {
  return request<AdminDriverEarningsRow[]>('/admin/earnings/by-driver', { method: 'GET', accessToken });
}

/** Section 14's "Audit Logs" — SUPER_ADMIN only server-side. */
export function listAdminAuditLogs(accessToken: string): Promise<AdminAuditLogEntry[]> {
  return request<AdminAuditLogEntry[]>('/admin/audit-logs', { method: 'GET', accessToken });
}
