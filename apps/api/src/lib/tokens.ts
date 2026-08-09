import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from './roles';

export interface AccessTokenPayload {
  userId: string;
  role: UserRole;
}

/**
 * Short-lived, stateless access token. The server never needs to look
 * anything up to trust it — signature + expiry are enough — which is why
 * it must stay short-lived (see JWT_ACCESS_TOKEN_TTL). Long-lived state
 * (logout, rotation, revocation) lives in the `sessions` table instead,
 * via the refresh token below.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ role: payload.role }, env.JWT_ACCESS_SECRET, {
    subject: payload.userId,
    expiresIn: env.JWT_ACCESS_TOKEN_TTL,
  } as jwt.SignOptions);
}

export class InvalidAccessTokenError extends Error {
  constructor(message = 'Invalid or expired access token') {
    super(message);
    this.name = 'InvalidAccessTokenError';
  }
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: string | jwt.JwtPayload;

  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    throw new InvalidAccessTokenError();
  }

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.role !== 'string'
  ) {
    throw new InvalidAccessTokenError('Access token payload is malformed');
  }

  return { userId: decoded.sub, role: decoded.role as UserRole };
}

export interface GeneratedRefreshToken {
  /** Raw token — returned to the client once, never stored. */
  token: string;
  /** SHA-256 hex digest — what actually gets stored in `sessions`. */
  tokenHash: string;
}

/**
 * Refresh tokens are opaque random values, not JWTs — they carry no
 * client-decodable payload and can be revoked (logout, rotation) because
 * each one's hash is a real database row that can be marked revoked.
 */
export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashOpaqueToken(token) };
}

/** Same hashing used for refresh tokens and password-reset tokens. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
