import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import type { UserRole } from '../lib/roles';
import { InvalidAccessTokenError, verifyAccessToken } from '../lib/tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth once the access token has been verified. */
      auth?: { userId: string; role: UserRole };
    }
  }
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the Authorization header's access token and attaches
 * `req.auth`. This is the *only* place a role is ever trusted from a
 * client request — it comes from the server-signed JWT, never from a
 * request body or query param (section 7: never trust client-provided
 * administrative role).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) {
      next(new UnauthorizedError(error.message));
      return;
    }
    next(error);
  }
}

/**
 * Must run after requireAuth. Rejects unless req.auth.role is one of the
 * allowed roles — a 403, not a hidden button, is what actually stops a
 * passenger from calling a driver-only or admin-only endpoint.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new ForbiddenError(`This action requires one of these roles: ${roles.join(', ')}`));
      return;
    }

    next();
  };
}
