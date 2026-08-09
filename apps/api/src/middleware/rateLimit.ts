import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

interface LimiterOptions {
  windowMs: number;
  max: number;
  message: string;
}

function createLimiter({ windowMs, max, message }: LimiterOptions) {
  return rateLimit({
    windowMs,
    // Per-IP counters make an automated test suite (many requests from
    // 127.0.0.1 in quick succession) trip the same limit a real attacker
    // would. Rather than disabling the middleware under test — which
    // would leave it unexercised — raise the ceiling enough that normal
    // test runs never hit it, while a wiring bug still would.
    max: env.NODE_ENV === 'test' ? max * 1000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    // Route through the app's normal error envelope (with requestId)
    // instead of express-rate-limit's own default plaintext response.
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', message));
    },
  });
}

export const loginLimiter = createLimiter({
  windowMs: 15 * MINUTE_MS,
  max: 20,
  message: 'Too many login attempts. Try again later.',
});

export const registerLimiter = createLimiter({
  windowMs: HOUR_MS,
  max: 10,
  message: 'Too many registration attempts. Try again later.',
});

export const passwordResetLimiter = createLimiter({
  windowMs: HOUR_MS,
  max: 10,
  message: 'Too many password reset requests. Try again later.',
});

export const routePreviewLimiter = createLimiter({
  windowMs: MINUTE_MS,
  max: 30,
  message: 'Too many route preview requests. Try again in a moment.',
});
