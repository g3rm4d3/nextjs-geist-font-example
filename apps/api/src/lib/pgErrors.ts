/**
 * drizzle-orm wraps driver errors in a DrizzleQueryError whose own
 * `.message` is generic ("Failed query: ..."); the real Postgres error
 * (with `.code` and `.constraint`) lives on `.cause`. This inspects both
 * shapes so callers don't need to know which one they got.
 */
interface PgErrorLike {
  code?: string;
  constraint?: string;
}

function extractPgError(error: unknown): PgErrorLike | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as { cause?: unknown; code?: unknown; constraint?: unknown };
  if (typeof candidate.code === 'string') {
    return { code: candidate.code, constraint: pluckString(candidate.constraint) };
  }

  if (candidate.cause && typeof candidate.cause === 'object') {
    const cause = candidate.cause as { code?: unknown; constraint?: unknown };
    if (typeof cause.code === 'string') {
      return { code: cause.code, constraint: pluckString(cause.constraint) };
    }
  }

  return undefined;
}

function pluckString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Postgres error code 23505 = unique_violation. */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  const pgError = extractPgError(error);
  if (!pgError || pgError.code !== '23505') return false;
  return constraintName ? pgError.constraint === constraintName : true;
}
