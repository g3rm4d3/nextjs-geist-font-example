import { ValidationError } from './errors';

/**
 * Express types every route param as `string | string[] | undefined`
 * (a repeated `:id` segment, e.g. from a malformed proxy rewrite, would
 * be an array) — only a single plain string is ever a valid id for any
 * of this API's `:id`-shaped routes. Shared across route files (Phase 8's
 * driver offers, Phase 9's ride lifecycle) so this check exists once.
 */
export function requireIdParam(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`A valid ${label} is required`);
  }
  return value;
}
