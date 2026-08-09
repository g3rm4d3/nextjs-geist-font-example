import { z } from 'zod';

/**
 * Shared request-payload schemas for authentication. apps/api runs these
 * server-side as the authoritative check; client apps may reuse them for
 * inline form validation, but a client passing this schema is never a
 * substitute for the server re-validating the same payload.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320) // RFC 5321 practical upper bound
  // Order matters: trim/lowercase/length run first, then the email format
  // check — z.email() validates its input as-is, so chaining it *before*
  // trim() would reject a merely-whitespace-padded address.
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((value) => /[a-zA-Z]/.test(value), 'Password must contain at least one letter')
  .refine((value) => /[0-9]/.test(value), 'Password must contain at least one number');

const nameSchema = z.string().trim().min(1, 'Required').max(100);

export const registerPassengerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: z.string().trim().min(1).max(32).optional(),
});
export type RegisterPassengerInput = z.infer<typeof registerPassengerSchema>;

export const registerDriverSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: z.string().trim().min(1).max(32).optional(),
  licenseNumber: z.string().trim().min(1).max(64),
  licenseState: z.string().trim().min(2).max(32),
});
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1, 'token is required'),
  newPassword: passwordSchema,
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
