import { describe, expect, it } from 'vitest';
import {
  confirmPasswordResetSchema,
  loginSchema,
  passwordSchema,
  registerDriverSchema,
  registerPassengerSchema,
} from './auth';

describe('emailSchema (via loginSchema)', () => {
  it('lowercases and trims a valid email', () => {
    const result = loginSchema.safeParse({ email: '  Jane.Doe@Example.com  ', password: 'x' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('jane.doe@example.com');
  });

  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts a password with a letter and a number', () => {
    expect(passwordSchema.safeParse('abcd1234').success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(passwordSchema.safeParse('a1b2c3').success).toBe(false);
  });

  it('rejects a password with no digit', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
  });

  it('rejects a password with no letter', () => {
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
  });
});

describe('registerPassengerSchema', () => {
  it('accepts a well-formed payload without a phone', () => {
    const result = registerPassengerSchema.safeParse({
      email: 'jane@example.com',
      password: 'abcd1234',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing firstName', () => {
    const result = registerPassengerSchema.safeParse({
      email: 'jane@example.com',
      password: 'abcd1234',
      lastName: 'Doe',
    });
    expect(result.success).toBe(false);
  });
});

describe('registerDriverSchema', () => {
  it('requires licenseNumber and licenseState', () => {
    const result = registerDriverSchema.safeParse({
      email: 'driver@example.com',
      password: 'abcd1234',
      firstName: 'Dana',
      lastName: 'Driver',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed driver payload', () => {
    const result = registerDriverSchema.safeParse({
      email: 'driver@example.com',
      password: 'abcd1234',
      firstName: 'Dana',
      lastName: 'Driver',
      licenseNumber: 'DL-123',
      licenseState: 'CA',
    });
    expect(result.success).toBe(true);
  });
});

describe('confirmPasswordResetSchema', () => {
  it('requires both token and a valid newPassword', () => {
    expect(
      confirmPasswordResetSchema.safeParse({ token: 'abc', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      confirmPasswordResetSchema.safeParse({ token: 'abc', newPassword: 'abcd1234' }).success,
    ).toBe(true);
  });
});
