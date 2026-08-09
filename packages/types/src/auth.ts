/**
 * Auth-related API contracts, shared by apps/api (producer) and any
 * client (consumer). Role/status string unions are duplicated by hand
 * from packages/database/src/schema/enums.ts rather than imported —
 * this package stays dependency-free on purpose (see docs/architecture.md)
 * — so keep them in sync if the database enums change.
 */

export type UserRole = 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN';

export type DriverOnboardingStatus =
  'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  /** Present only when role === 'DRIVER'. */
  driverOnboardingStatus?: DriverOnboardingStatus;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}
