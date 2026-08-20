import { describe, expect, it } from 'vitest';
import { createInMemoryMetricsRecorder } from './metrics';

describe('createInMemoryMetricsRecorder', () => {
  it('starts empty', () => {
    const recorder = createInMemoryMetricsRecorder();
    expect(recorder.summarize()).toEqual([]);
  });

  it('aggregates samples for the same method+route into one summary', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'get', route: '/rides/:id', statusCode: 200, durationMs: 10 });
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 200, durationMs: 20 });
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 200, durationMs: 30 });

    const summary = recorder.summarize();
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ method: 'GET', route: '/rides/:id', count: 3, errorCount: 0 });
    expect(summary[0]!.avgDurationMs).toBeCloseTo(20);
    expect(summary[0]!.maxDurationMs).toBe(30);
  });

  it('method casing is normalized, not a separate bucket', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'post', route: '/rides', statusCode: 201, durationMs: 5 });
    recorder.record({ method: 'POST', route: '/rides', statusCode: 201, durationMs: 5 });

    expect(recorder.summarize()).toHaveLength(1);
    expect(recorder.summarize()[0]!.count).toBe(2);
  });

  it('different routes and methods get separate buckets', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 200, durationMs: 10 });
    recorder.record({ method: 'POST', route: '/rides', statusCode: 201, durationMs: 10 });
    recorder.record({ method: 'GET', route: '/drivers/me', statusCode: 200, durationMs: 10 });

    expect(recorder.summarize()).toHaveLength(3);
  });

  it('counts only statusCode >= 500 as an error, not 4xx', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 404, durationMs: 5 });
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 500, durationMs: 5 });
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 503, durationMs: 5 });

    expect(recorder.summarize()[0]!.errorCount).toBe(2);
    expect(recorder.summarize()[0]!.count).toBe(3);
  });

  it('p95 reflects the higher end of the recorded durations', () => {
    const recorder = createInMemoryMetricsRecorder();
    for (let i = 1; i <= 100; i += 1) {
      recorder.record({ method: 'GET', route: '/x', statusCode: 200, durationMs: i });
    }

    // The 95th percentile of 1..100 should sit right around 95.
    expect(recorder.summarize()[0]!.p95DurationMs).toBeGreaterThanOrEqual(94);
    expect(recorder.summarize()[0]!.p95DurationMs).toBeLessThanOrEqual(96);
  });

  it('count/sum/max stay exact even once a route exceeds the ring buffer size', () => {
    const recorder = createInMemoryMetricsRecorder(10);
    for (let i = 1; i <= 25; i += 1) {
      recorder.record({ method: 'GET', route: '/x', statusCode: 200, durationMs: i });
    }

    const summary = recorder.summarize()[0]!;
    expect(summary.count).toBe(25);
    expect(summary.maxDurationMs).toBe(25);
    expect(summary.avgDurationMs).toBeCloseTo((1 + 25) / 2, 1);
  });

  it('summarize sorts busiest routes first', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'GET', route: '/rare', statusCode: 200, durationMs: 1 });
    for (let i = 0; i < 5; i += 1) {
      recorder.record({ method: 'GET', route: '/busy', statusCode: 200, durationMs: 1 });
    }

    const summary = recorder.summarize();
    expect(summary[0]!.route).toBe('/busy');
    expect(summary[1]!.route).toBe('/rare');
  });

  it('reset clears every bucket', () => {
    const recorder = createInMemoryMetricsRecorder();
    recorder.record({ method: 'GET', route: '/rides/:id', statusCode: 200, durationMs: 10 });
    recorder.reset();
    expect(recorder.summarize()).toEqual([]);
  });
});
