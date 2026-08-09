import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../lib/errors';

/**
 * Parses and validates `req.body` against a Zod schema, replacing
 * `req.body` with the parsed (and possibly transformed — trimmed,
 * lowercased) result on success. On failure, produces the same
 * ApiErrorResponse.error.details shape as every other validation error.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
        (details[path] ??= []).push(issue.message);
      }
      next(new ValidationError('Invalid request body', details));
      return;
    }

    req.body = result.data;
    next();
  };
}
