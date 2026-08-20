/**
 * Phase 22's "performance metrics" — a minimal, dependency-free,
 * in-process request-timing recorder. Deliberately not a
 * Prometheus/StatsD/OpenTelemetry client: those need an external
 * collector this environment has no way to provision (same reasoning as
 * `ErrorTracker` above), and pino-http (already wired in `apps/api/src/
 * app.ts`) already puts a per-request `responseTime` field into every
 * structured log line, which is real, queryable performance data on its
 * own. This recorder adds the one thing raw log lines don't give you
 * for free: an aggregated, queryable-right-now summary per route+method
 * (count, error rate, average/max/p95 latency), surfaced at
 * `GET /admin/metrics`.
 */

export interface RouteMetricSample {
  method: string;
  /** The route *pattern* (e.g. `/rides/:id`), not the literal URL — so
   * `/rides/abc` and `/rides/def` aggregate together instead of each
   * getting their own never-repeated bucket. Callers are responsible
   * for passing the pattern; see `metricsMiddleware` in apps/api. */
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface RouteMetricSummary {
  method: string;
  route: string;
  count: number;
  /** Count of samples with `statusCode >= 500` — server errors, not
   * expected 4xx client errors (a validation failure or a 404 isn't a
   * performance or reliability problem). */
  errorCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
  /** 95th-percentile latency across the retained samples for this
   * route+method. See `createInMemoryMetricsRecorder`'s doc comment for
   * what "retained" means once a route exceeds the ring buffer size. */
  p95DurationMs: number;
}

export interface MetricsRecorder {
  record(sample: RouteMetricSample): void;
  summarize(): RouteMetricSummary[];
  /** Clears all recorded samples — used by apps/api's own test setup so
   * metrics tests don't see samples left over from a previous test. */
  reset(): void;
}

interface Bucket {
  method: string;
  route: string;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  /** Fixed-size ring buffer of the most recent durations for this
   * route+method, used only to estimate p95 — `count`/`errorCount`/
   * `totalDurationMs`/`maxDurationMs` above are exact running totals
   * across every sample ever recorded, never truncated. */
  recentDurationsMs: number[];
}

function bucketKey(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)]!;
}

/**
 * In-memory, single-process metrics store. `maxSamplesPerRoute` bounds
 * memory for a route+method pair that receives sustained high traffic —
 * exact count/sum/max never get pruned (so the average and total are
 * always exact), only the p95 estimate is drawn from the most recent
 * `maxSamplesPerRoute` samples once a route exceeds that many.
 *
 * **Known limitation, documented rather than hidden**: this is
 * per-process state. It resets on every restart and, in a
 * multi-instance deployment, only reflects whichever instance answered
 * `GET /admin/metrics` — there is no cross-instance aggregation. Stage 1
 * runs a single `apps/api` process, so this is a complete picture today;
 * a real horizontally-scaled deployment would want a real metrics
 * backend (Prometheus + a registry client, most likely) instead of this.
 */
export function createInMemoryMetricsRecorder(maxSamplesPerRoute = 500): MetricsRecorder {
  const buckets = new Map<string, Bucket>();

  return {
    record(sample: RouteMetricSample): void {
      const key = bucketKey(sample.method, sample.route);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          method: sample.method.toUpperCase(),
          route: sample.route,
          count: 0,
          errorCount: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          recentDurationsMs: [],
        };
        buckets.set(key, bucket);
      }

      bucket.count += 1;
      if (sample.statusCode >= 500) bucket.errorCount += 1;
      bucket.totalDurationMs += sample.durationMs;
      bucket.maxDurationMs = Math.max(bucket.maxDurationMs, sample.durationMs);
      bucket.recentDurationsMs.push(sample.durationMs);
      if (bucket.recentDurationsMs.length > maxSamplesPerRoute) {
        bucket.recentDurationsMs.shift();
      }
    },

    summarize(): RouteMetricSummary[] {
      return Array.from(buckets.values())
        .map((bucket) => ({
          method: bucket.method,
          route: bucket.route,
          count: bucket.count,
          errorCount: bucket.errorCount,
          avgDurationMs: bucket.count > 0 ? bucket.totalDurationMs / bucket.count : 0,
          maxDurationMs: bucket.maxDurationMs,
          p95DurationMs: percentile([...bucket.recentDurationsMs].sort((a, b) => a - b), 95),
        }))
        .sort((a, b) => b.count - a.count);
    },

    reset(): void {
      buckets.clear();
    },
  };
}
