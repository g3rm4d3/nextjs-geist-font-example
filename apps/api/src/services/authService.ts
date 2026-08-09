import type { AuthResponse, AuthUser } from '@rideshare/types';
import { hashPassword, verifyPassword } from '@rideshare/auth';
import type {
  ConfirmPasswordResetInput,
  LoginInput,
  RegisterDriverInput,
  RegisterPassengerInput,
} from '@rideshare/validation';
import { env } from '../config/env';
import { ConflictError, UnauthorizedError, ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isUniqueViolation } from '../lib/pgErrors';
import { generateRefreshToken, hashOpaqueToken, signAccessToken } from '../lib/tokens';
import {
  createPasswordResetToken,
  findPasswordResetTokenByHash,
  markPasswordResetTokenUsed,
} from '../repositories/passwordResetTokensRepository';
import {
  createSession,
  findSessionByTokenHash,
  revokeAllSessionsForUser,
  revokeSession,
} from '../repositories/sessionsRepository';
import {
  createDriver,
  createPassenger,
  findDriverProfileByUserId,
  findUserByEmail,
  findUserById,
  updatePasswordHash,
  type DriverProfileRow,
  type UserRow,
} from '../repositories/usersRepository';

export interface RequestContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

const ACCESS_TOKEN_TTL_SECONDS = parseAccessTokenTtlSeconds(env.JWT_ACCESS_TOKEN_TTL);

async function issueTokens(
  user: UserRow,
  context: RequestContext,
): Promise<AuthResponse['tokens']> {
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const { token: refreshToken, tokenHash } = generateRefreshToken();

  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await createSession({
    userId: user.id,
    refreshTokenHash: tokenHash,
    expiresAt,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  };
}

function toAuthUser(user: UserRow, driverProfile?: DriverProfileRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    ...(driverProfile ? { driverOnboardingStatus: driverProfile.onboardingStatus } : {}),
  };
}

export async function registerPassenger(
  input: RegisterPassengerInput,
  context: RequestContext,
): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);

  let user;
  try {
    ({ user } = await createPassenger({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    }));
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw new ConflictError('An account with this email already exists');
    }
    throw error;
  }

  logger.info({ userId: user.id, role: user.role }, 'Passenger registered');
  const tokens = await issueTokens(user, context);
  return { user: toAuthUser(user), tokens };
}

export async function registerDriver(
  input: RegisterDriverInput,
  context: RequestContext,
): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);

  let user;
  let profile;
  try {
    ({ user, profile } = await createDriver({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      licenseNumber: input.licenseNumber,
      licenseState: input.licenseState,
    }));
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw new ConflictError('An account with this email already exists');
    }
    if (isUniqueViolation(error, 'driver_profiles_license_number_key')) {
      throw new ConflictError('An account with this license number already exists');
    }
    throw error;
  }

  logger.info({ userId: user.id, role: user.role }, 'Driver registered');
  const tokens = await issueTokens(user, context);
  return { user: toAuthUser(user, profile), tokens };
}

/**
 * Deliberately generic failure message and identical timing-relevant code
 * path whether the email doesn't exist or the password is wrong — never
 * reveal which one it was (user enumeration).
 */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export async function login(input: LoginInput, context: RequestContext): Promise<AuthResponse> {
  const user = await findUserByEmail(input.email);

  if (!user?.passwordHash) {
    // Still run a hash comparison against a dummy value so responding to
    // "no such user" doesn't take measurably less time than "wrong
    // password" (a classic user-enumeration timing side-channel).
    await verifyPassword(input.password, DUMMY_BCRYPT_HASH);
    logger.warn({ email: input.email }, 'Login failed: no such account');
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    logger.warn({ userId: user.id }, 'Login failed: wrong password');
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  if (!user.isActive) {
    logger.warn({ userId: user.id }, 'Login failed: account disabled');
    throw new UnauthorizedError('This account has been disabled');
  }

  const driverProfile =
    user.role === 'DRIVER' ? await findDriverProfileByUserId(user.id) : undefined;

  logger.info({ userId: user.id, role: user.role }, 'Login succeeded');
  const tokens = await issueTokens(user, context);
  return { user: toAuthUser(user, driverProfile), tokens };
}

// A real bcrypt hash of an unguessable placeholder — used only for the
// timing-attack mitigation above, never as a real credential.
const DUMMY_BCRYPT_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO0k8dQiMPBcCZFn.LNRV0jDPBqE9DHmy';

export async function refresh(rawToken: string, context: RequestContext): Promise<AuthResponse> {
  const tokenHash = hashOpaqueToken(rawToken);
  const session = await findSessionByTokenHash(tokenHash);

  if (!session) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (session.revokedAt) {
    // Reuse of an already-rotated/revoked refresh token strongly suggests
    // the token was stolen — revoke the whole session family defensively.
    logger.warn(
      { userId: session.userId, sessionId: session.id },
      'Refresh token reuse detected — revoking all sessions for this user',
    );
    await revokeAllSessionsForUser(session.userId);
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Refresh token has expired');
  }

  const user = await findUserById(session.userId);
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Rotation: revoke the token just used and issue a fresh pair.
  await revokeSession(session.id);

  const driverProfile =
    user.role === 'DRIVER' ? await findDriverProfileByUserId(user.id) : undefined;
  const tokens = await issueTokens(user, context);
  return { user: toAuthUser(user, driverProfile), tokens };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken);
  const session = await findSessionByTokenHash(tokenHash);
  // Always succeed, even for an unknown token — logging out of a session
  // that doesn't exist (already expired, already logged out elsewhere)
  // isn't an error from the caller's point of view, and confirming which
  // tokens exist would leak information.
  if (session && !session.revokedAt) {
    await revokeSession(session.id);
  }
}

export interface RequestPasswordResetResult {
  /** Only populated outside production — see docs/authentication.md. */
  devResetToken?: string;
}

export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  const user = await findUserByEmail(email);

  // Always return success shape regardless of whether the account exists
  // — otherwise this endpoint becomes a user-enumeration oracle.
  if (!user) {
    logger.info({ email }, 'Password reset requested for unknown email (no-op)');
    return {};
  }

  const rawToken = generateRefreshToken().token; // same opaque-token shape works fine here
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });
  logger.info({ userId: user.id }, 'Password reset token issued');

  // Phase 16 (NotificationProvider) is what actually delivers this by
  // email; until then, dev/test callers get the raw token back directly
  // so the flow is testable without a real mail provider. Never exposed
  // when NODE_ENV=production.
  return env.NODE_ENV === 'production' ? {} : { devResetToken: rawToken };
}

export async function confirmPasswordReset(input: ConfirmPasswordResetInput): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const resetToken = await findPasswordResetTokenByHash(tokenHash);

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('This password reset link is invalid or has expired');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await updatePasswordHash(resetToken.userId, passwordHash);
  await markPasswordResetTokenUsed(resetToken.id);
  // Compromise scenario this defends against: an attacker who stole an
  // old refresh token loses access the moment the legitimate user resets
  // their password.
  await revokeAllSessionsForUser(resetToken.userId);

  logger.info({ userId: resetToken.userId }, 'Password reset completed; all sessions revoked');
}

/**
 * Takes an already-verified userId (from requireAuth — see
 * middleware/auth.ts) rather than a raw token; token verification is the
 * middleware's job, not the service layer's.
 */
export async function getMe(userId: string): Promise<AuthUser> {
  const user = await findUserById(userId);
  if (!user) throw new UnauthorizedError('Account no longer exists');

  const driverProfile =
    user.role === 'DRIVER' ? await findDriverProfileByUserId(user.id) : undefined;
  return toAuthUser(user, driverProfile);
}

function parseAccessTokenTtlSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    // Fallback: jsonwebtoken also accepts bare seconds as a string.
    const asNumber = Number(ttl);
    return Number.isFinite(asNumber) ? asNumber : 900;
  }

  const [, amountStr, unit] = match;
  const amount = Number(amountStr);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return amount * unitSeconds[unit as keyof typeof unitSeconds];
}
