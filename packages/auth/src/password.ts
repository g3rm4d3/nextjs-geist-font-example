import bcrypt from 'bcrypt';

/**
 * bcrypt cost factor. 12 is a widely-recommended default (~250ms/hash on
 * typical hardware as of 2026) — high enough to resist offline brute
 * force, low enough not to bottleneck login. Not env-configurable on
 * purpose: this should change deliberately, in code review, not via a
 * stray environment variable.
 */
const SALT_ROUNDS = 12;

/**
 * bcrypt silently truncates input beyond 72 bytes rather than erroring,
 * which can quietly weaken a password (or make two different long
 * passwords hash identically). Reject anything over the limit instead of
 * truncating in silence.
 */
const BCRYPT_MAX_BYTES = 72;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  if (Buffer.byteLength(plainTextPassword, 'utf8') > BCRYPT_MAX_BYTES) {
    throw new Error(`Password exceeds the ${BCRYPT_MAX_BYTES}-byte limit bcrypt can hash safely`);
  }
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, passwordHash);
}
