import { describe, expect, it, vi } from 'vitest';
import { createLoggingErrorTracker } from './loggingErrorTracker';

function makeLogger() {
  return { error: vi.fn() };
}

describe('createLoggingErrorTracker', () => {
  it('logs an Error instance with its message and context merged in', () => {
    const logger = makeLogger();
    const tracker = createLoggingErrorTracker(logger);
    const error = new Error('boom');

    tracker.captureException(error, { requestId: 'req-1', rideId: 'ride-1' });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload, msg] = logger.error.mock.calls[0]!;
    expect(msg).toBe('boom');
    expect(payload).toMatchObject({
      err: error,
      requestId: 'req-1',
      rideId: 'ride-1',
      event: 'error_tracked',
    });
  });

  it('wraps a non-Error thrown value in a real Error rather than passing it through raw', () => {
    const logger = makeLogger();
    const tracker = createLoggingErrorTracker(logger);

    tracker.captureException('a plain string was thrown');

    const [payload] = logger.error.mock.calls[0]!;
    expect(payload.err).toBeInstanceOf(Error);
    expect(payload.err.message).toBe('a plain string was thrown');
    expect(payload.event).toBe('error_tracked');
  });

  it('works with no context at all', () => {
    const logger = makeLogger();
    const tracker = createLoggingErrorTracker(logger);

    expect(() => tracker.captureException(new Error('no context'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('never throws, even if the underlying logger itself throws', () => {
    const logger = { error: vi.fn(() => { throw new Error('logger is broken'); }) };
    const tracker = createLoggingErrorTracker(logger);

    expect(() => tracker.captureException(new Error('original failure'))).not.toThrow();
  });

  it('every event is tagged so it can be filtered as its own stream', () => {
    const logger = makeLogger();
    const tracker = createLoggingErrorTracker(logger);

    tracker.captureException(new Error('one'));
    tracker.captureException(new Error('two'), { route: '/rides' });

    for (const call of logger.error.mock.calls) {
      expect(call[0].event).toBe('error_tracked');
    }
  });
});
