import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger } from './index';

describe('createLogger', () => {
  it('creates a pino logger tagged with the service name', () => {
    const logger = createLogger({ service: 'test-service' });
    expect(logger.level).toBeDefined();
  });

  it('redacts sensitive fields such as password and token', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const logger = pino(
      {
        redact: { paths: ['password', 'token'], censor: '[REDACTED]' },
      },
      sink,
    );

    logger.info({ password: 'super-secret', token: 'abc123', username: 'jane' }, 'login attempt');

    const logged = JSON.parse(lines[0] ?? '{}');
    expect(logged.password).toBe('[REDACTED]');
    expect(logged.token).toBe('[REDACTED]');
    expect(logged.username).toBe('jane');
  });
});
