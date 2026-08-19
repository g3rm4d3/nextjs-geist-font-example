/**
 * Shared plumbing for apps/api's dev-only simulator scripts
 * (locationSimulator.ts, simulate.ts). Both scripts need the same three
 * things — synthetic identities created directly in the database (never
 * through the public register/login endpoints; see locationSimulator.ts's
 * own module comment for exactly why that's deliberate, not a shortcut),
 * a shared fictional city center to cluster coordinates around, and a
 * tiny latency/error metrics collector — so this module exists to avoid
 * two copies of each drifting apart.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@rideshare/database';
import { db } from '../src/db/client';
import { signAccessToken } from '../src/lib/tokens';

// Same fictional city center used by the seed data, both mobile apps'
// mock-GPS fallback, and locationSimulator.ts — keeps every dev-mode
// coordinate in this project clustered in one place.
export const CITY_CENTER = { latitude: 39.7684, longitude: -86.158 };

export function randomOffset(maxDegrees: number): number {
  return (Math.random() - 0.5) * 2 * maxDegrees;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VirtualDriver {
  index: number;
  userId: string;
  driverProfileId: string;
  accessToken: string;
  latitude: number;
  longitude: number;
}

export interface VirtualPassenger {
  index: number;
  userId: string;
  passengerProfileId: string;
  accessToken: string;
}

/**
 * Inserts one already-APPROVED driver (users + driver_profiles) and signs
 * a real access token for it, exactly like locationSimulator.ts's own
 * createVirtualDriver — factored out here so both scripts share one
 * definition. `runId` scopes every identity's email/license to one
 * simulator invocation so repeated runs never collide, and doubles as a
 * label for finding (and, via `npm run db:reset`, clearing) everything a
 * given run created.
 */
export async function createVirtualDriver(runId: string, index: number): Promise<VirtualDriver> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `sim-load-${runId}-driver-${index}@example-test.test`,
      role: 'DRIVER',
      passwordHash: null,
    })
    .returning({ id: schema.users.id });
  if (!user) throw new Error(`Failed to create virtual driver user ${index}`);

  const [profile] = await db
    .insert(schema.driverProfiles)
    .values({
      userId: user.id,
      firstName: 'Sim',
      lastName: `Driver${index}`,
      licenseNumber: `SIM-DL-${runId}-${index}`,
      licenseState: 'CA',
      onboardingStatus: 'APPROVED',
    })
    .returning({ id: schema.driverProfiles.id });
  if (!profile) throw new Error(`Failed to create virtual driver profile ${index}`);

  const accessToken = signAccessToken({ userId: user.id, role: 'DRIVER' });

  return {
    index,
    userId: user.id,
    driverProfileId: profile.id,
    accessToken,
    latitude: CITY_CENTER.latitude + randomOffset(0.03),
    longitude: CITY_CENTER.longitude + randomOffset(0.03),
  };
}

/** Same shortcut as createVirtualDriver, for the passenger side — a
 * ride-requesting identity has no onboarding/approval concept to satisfy,
 * so this is even simpler: one users row, one passenger_profiles row. */
export async function createVirtualPassenger(runId: string, index: number): Promise<VirtualPassenger> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `sim-load-${runId}-passenger-${index}-${randomUUID().slice(0, 8)}@example-test.test`,
      role: 'PASSENGER',
      passwordHash: null,
    })
    .returning({ id: schema.users.id });
  if (!user) throw new Error(`Failed to create virtual passenger user ${index}`);

  const [profile] = await db
    .insert(schema.passengerProfiles)
    .values({
      userId: user.id,
      firstName: 'Sim',
      lastName: `Passenger${index}`,
    })
    .returning({ id: schema.passengerProfiles.id });
  if (!profile) throw new Error(`Failed to create virtual passenger profile ${index}`);

  const accessToken = signAccessToken({ userId: user.id, role: 'PASSENGER' });

  return { index, userId: user.id, passengerProfileId: profile.id, accessToken };
}

export interface MetricSample {
  category: string;
  name: string;
  durationMs: number;
  ok: boolean;
  status: number | null;
  errorCode?: string;
}

export interface CategoryStats {
  count: number;
  errorCount: number;
  errorRate: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
}

/**
 * Every timed HTTP call across every scenario funnels through one of
 * these, tagged by `category` (roughly "which scenario") — Phase 19's
 * "Measure: matching latency / API latency / ... / error rate / failed
 * state transitions" is entirely built from querying this collector at
 * the end of the run, not from bespoke per-scenario counters.
 */
export class MetricsCollector {
  private samples: MetricSample[] = [];
  private peakInFlight = 0;
  private inFlight = 0;

  /** Wraps one HTTP (or DB) call: measures wall-clock duration, records
   * it under `category`/`name`, and tracks peak concurrent in-flight
   * calls — the simulator's stand-in for "realtime connections" (Stage 1
   * has no websocket/SSE transport; see docs/simulation-results.md). */
  async timed<T>(
    category: string,
    name: string,
    fn: () => Promise<{ ok: boolean; status: number | null; errorCode?: string; value: T }>,
  ): Promise<T> {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    const start = performance.now();
    try {
      const { ok, status, errorCode, value } = await fn();
      this.samples.push({ category, name, durationMs: performance.now() - start, ok, status, errorCode });
      return value;
    } finally {
      this.inFlight -= 1;
    }
  }

  getPeakInFlight(): number {
    return this.peakInFlight;
  }

  /** For measurements that never went through apiCall/timed — matching
   * latency computed from database timestamps, or a scenario's pass/fail
   * outcome where "duration" doesn't apply (durationMs 0 is fine there;
   * `ok` is what statsFor's errorRate actually reports on). Kept as a
   * distinct entry point rather than overloading `timed` so a
   * scenario's HTTP-call latencies and its own derived/outcome
   * measurements land in different categories by convention, not by
   * accident — see simulate.ts's own category-naming comments. */
  recordDirect(category: string, name: string, durationMs: number, ok: boolean, status: number | null = null): void {
    this.samples.push({ category, name, durationMs, ok, status });
  }

  all(): readonly MetricSample[] {
    return this.samples;
  }

  /** Every sample whose HTTP status was exactly 409 — Phase 19's "failed
   * state transitions": a client attempted a transition the server's
   * state machine correctly refused (a losing race, a stale action, an
   * invalid cancel). Grouped by category so an *expected* 409 (the
   * two-driver race scenario wants exactly one) reads differently from
   * an *unexpected* one (should never appear anywhere else). */
  conflicts(): readonly MetricSample[] {
    return this.samples.filter((s) => s.status === 409);
  }

  statsFor(category: string): CategoryStats | null {
    const rows = this.samples.filter((s) => s.category === category);
    if (rows.length === 0) return null;
    return summarize(rows);
  }

  overall(): CategoryStats {
    return summarize(this.samples);
  }

  categories(): string[] {
    return [...new Set(this.samples.map((s) => s.category))];
  }
}

function summarize(rows: MetricSample[]): CategoryStats {
  const durations = rows.map((r) => r.durationMs).sort((a, b) => a - b);
  const errorCount = rows.filter((r) => !r.ok).length;
  const percentile = (p: number): number => {
    const idx = Math.min(durations.length - 1, Math.floor((p / 100) * durations.length));
    return durations[idx] ?? 0;
  };
  return {
    count: rows.length,
    errorCount,
    errorRate: errorCount / rows.length,
    minMs: durations[0] ?? 0,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    maxMs: durations[durations.length - 1] ?? 0,
    avgMs: durations.reduce((sum, d) => sum + d, 0) / durations.length,
  };
}
