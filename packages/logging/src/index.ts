import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Field paths that must never appear in logs, redacted regardless of nesting
 * depth or casing convention. Extend this list rather than logging raw
 * request/user objects that might carry one of these fields.
 */
const REDACTED_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'req.headers.authorization',
  'cookie',
  'req.headers.cookie',
  'apiKey',
  'secret',
  'webhookSecret',
  'cardNumber',
  'cvv',
  '*.password',
  '*.token',
  '*.secret',
];

export interface CreateLoggerOptions {
  /** Name of the service emitting logs, e.g. "api". Included on every line. */
  service: string;
  /** Minimum level to emit. Defaults to "info", or "debug" outside production. */
  level?: LoggerOptions['level'];
  /** Pretty-print for local development. Never enable in production. */
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, pretty = false } = options;
  const level = options.level ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

  return pino({
    level,
    base: { service },
    redact: {
      paths: REDACTED_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : {}),
  });
}

export type { Logger };
