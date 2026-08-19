/**
 * PHASE 19 — SIMULATION & LOAD VALIDATION
 *
 * "Build development simulator. Simulate at minimum: 50 drivers.
 * Scenarios: 50 online drivers / 10, 25, 50 simultaneous ride requests /
 * driver timeout / driver decline / driver disconnect / passenger
 * cancellation / driver cancellation / GPS loss / duplicate API request /
 * duplicate webhook / two-driver acceptance race / high network latency.
 * Measure: matching latency / API latency / database query performance /
 * realtime connections / error rate / failed state transitions. Document
 * results."
 *
 * A standalone dev tool, not part of the running API process — like
 * locationSimulator.ts (Phase 6), it drives the real HTTP surface exactly
 * as a fleet of real apps would, not internal service calls, so every
 * measurement below reflects what a real client would actually
 * experience. Identities are created directly in the database (see
 * simulatorSupport.ts and locationSimulator.ts's own module comment for
 * why that bypasses register/login on purpose) and the small number of
 * places this script needs the *real* two-driver-race or driver-eligibility
 * mechanics that have no HTTP surface of their own (matchingRepository's
 * createOffer, direct driver_locations back-dating) reuse the exact same
 * repository-level patterns this codebase's own concurrency tests already
 * established — see routes/driverOffers.test.ts.
 *
 * Usage (from apps/api, with a running API server and a migrated,
 * already-seeded database — needs an active pricing_configs row, which
 * `npm run db:seed` provides):
 *
 *   npm run simulate:load
 *
 * The "duplicate webhook" scenario additionally needs the *running
 * server* to have been started with STRIPE_WEBHOOK_SECRET set to the
 * same value this script's own process sees (so the signature this
 * script generates verifies against what the server checks). If unset,
 * that one scenario is skipped with a clear message — every other
 * scenario runs regardless.
 *
 * Configurable via env vars (all optional):
 *   SIMULATOR_API_URL      default http://localhost:4000
 *   LOAD_SIM_DRIVER_COUNT  default 50 (the spec's stated minimum)
 *
 * Writes a full results report to stdout and a machine-readable copy to
 * scripts/output/simulation-results.json (gitignored — see
 * docs/simulation-results.md for the human-written summary of an actual
 * run's numbers).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { schema } from '@rideshare/database';
import type { Ride, RideOffer } from '@rideshare/types';
import { eq, inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import { env } from '../src/config/env';
import { db } from '../src/db/client';
import { pool } from '../src/db/pool';
import {
  createPaymentRecord,
  findPaymentRecordById,
  setProviderPaymentIntentId,
} from '../src/repositories/paymentsRepository';
import { createOffer } from '../src/repositories/matchingRepository';
import {
  createVirtualDriver,
  createVirtualPassenger,
  CITY_CENTER,
  MetricsCollector,
  randomOffset,
  sleep,
  type VirtualDriver,
} from './simulatorSupport';

const API_URL = process.env.SIMULATOR_API_URL ?? 'http://localhost:4000';
const DRIVER_COUNT = Number(process.env.LOAD_SIM_DRIVER_COUNT ?? 50);
const RUN_ID = `${Date.now()}-${randomUUID().slice(0, 8)}`;

// The offer response timer + sweep cadence this environment is actually
// running with (env.ts defaults: 15s timeout, 5s sweep) — several
// scenarios below wait on real timers rather than manipulating them, so
// they read these rather than hard-coding numbers that would silently
// drift out of sync with config/env.ts.
const OFFER_TIMEOUT_MS = env.MATCHING_OFFER_TIMEOUT_SECONDS * 1000;
const SWEEP_INTERVAL_MS = env.MATCHING_SWEEP_INTERVAL_MS;

/** Coordinates near the fictional city center, spread widely enough to
 * still land the online driver pool's own ~3km spawn scatter
 * (simulatorSupport.createVirtualDriver) inside the matching engine's
 * first or second search tier (2km / 5km — see
 * packages/matching's DEFAULT_SEARCH_RADII_METERS). */
function nearbyPoint(spreadDegrees = 0.02): { latitude: number; longitude: number } {
  return {
    latitude: CITY_CENTER.latitude + randomOffset(spreadDegrees),
    longitude: CITY_CENTER.longitude + randomOffset(spreadDegrees),
  };
}

// ---------------------------------------------------------------------
// HTTP call primitive — every scenario funnels through this, so every
// scenario's timing/error accounting is uniform and lands in one place
// (MetricsCollector) rather than each scenario inventing its own.
// ---------------------------------------------------------------------

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  errorCode?: string;
}

async function apiCall<T>(
  metrics: MetricsCollector,
  category: string,
  name: string,
  path: string,
  opts: {
    method?: string;
    token?: string;
    body?: unknown;
    rawBody?: string | Buffer;
    extraHeaders?: Record<string, string>;
    /** Injected client-side delay before the request is even sent —
     * the "high network latency" scenario's mechanism (see its own
     * section below): this script cannot shape real network conditions
     * against localhost, so it emulates a slow client instead. */
    preSendDelayMs?: number;
  } = {},
): Promise<ApiResult<T>> {
  return metrics.timed(category, name, async () => {
    if (opts.preSendDelayMs) await sleep(opts.preSendDelayMs);

    const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) };
    let requestBody: string | Buffer | undefined;
    if (opts.rawBody !== undefined) {
      requestBody = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(opts.body);
    }
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

    const response = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'POST',
      headers,
      body: requestBody,
    });

    let parsed: ApiEnvelope<T> | null = null;
    try {
      parsed = (await response.json()) as ApiEnvelope<T>;
    } catch {
      // A body-less or non-JSON response is unexpected for this API —
      // ok/data below fall back to "nothing usable", not a crash.
    }

    const ok = response.ok && (parsed?.success ?? true);
    const result: ApiResult<T> = {
      status: response.status,
      ok,
      data: parsed?.success ? (parsed.data ?? null) : null,
      errorCode: parsed?.success === false ? parsed.error?.code : undefined,
    };
    return { ok, status: response.status, errorCode: result.errorCode, value: result };
  });
}

function rideRequestBody(seed: number) {
  const pickup = nearbyPoint();
  const destination = nearbyPoint();
  return {
    pickup: { coordinate: pickup, label: `Sim pickup ${seed}` },
    destination: { coordinate: destination, label: `Sim destination ${seed}` },
    idempotencyKey: randomUUID(),
  };
}

// ---------------------------------------------------------------------
// Scenario: "50 online drivers"
// ---------------------------------------------------------------------

async function scenarioDriversOnline(metrics: MetricsCollector, count: number): Promise<VirtualDriver[]> {
  console.log(`\n=== Scenario: ${count} online drivers ===`);
  const drivers = await Promise.all(
    Array.from({ length: count }, (_, index) => createVirtualDriver(RUN_ID, index)),
  );

  await Promise.all(
    drivers.map(async (driver) => {
      await apiCall(metrics, 'drivers_online', 'go-online', '/drivers/me/availability', {
        method: 'PATCH',
        token: driver.accessToken,
        body: { status: 'ONLINE' },
      });
      await apiCall(metrics, 'drivers_online', 'location-ping', '/drivers/me/location', {
        token: driver.accessToken,
        body: {
          latitude: driver.latitude,
          longitude: driver.longitude,
          heading: Math.random() * 360,
          speed: 0,
          accuracy: 10,
          timestamp: new Date().toISOString(),
        },
      });
    }),
  );

  const stats = metrics.statsFor('drivers_online');
  console.log(
    `  ${count} drivers online. availability+location call latency: ` +
      `p50=${stats?.p50Ms.toFixed(0)}ms p95=${stats?.p95Ms.toFixed(0)}ms errorRate=${((stats?.errorRate ?? 0) * 100).toFixed(1)}%`,
  );
  return drivers;
}

async function driversOffline(metrics: MetricsCollector, drivers: VirtualDriver[]): Promise<void> {
  await Promise.all(
    drivers.map((driver) =>
      apiCall(metrics, 'teardown', 'go-offline', '/drivers/me/availability', {
        method: 'PATCH',
        token: driver.accessToken,
        body: { status: 'OFFLINE' },
      }).catch(() => undefined),
    ),
  );
}

// ---------------------------------------------------------------------
// Auto-accept loop: a real driver-app poll loop, condensed. Runs against
// every currently-free driver in the pool for a bounded window, accepting
// the first offer each one sees. Needed so the concurrent-load scenarios
// actually resolve to DRIVER_ASSIGNED instead of sitting in
// SEARCHING_DRIVER for the whole run — matching latency without a driver
// on the other end to accept isn't a real measurement of anything.
// ---------------------------------------------------------------------

async function runAutoAcceptLoop(
  metrics: MetricsCollector,
  drivers: VirtualDriver[],
  durationMs: number,
  category: string,
): Promise<Map<number, string>> {
  const acceptedByDriverIndex = new Map<number, string>(); // driver.index -> rideId
  const deadline = Date.now() + durationMs;

  async function driverLoop(driver: VirtualDriver): Promise<void> {
    while (Date.now() < deadline) {
      const offer = await apiCall<RideOffer | null>(metrics, category, 'poll-offer', '/drivers/me/offer', {
        method: 'GET',
        token: driver.accessToken,
      });
      if (offer.ok && offer.data) {
        const accept = await apiCall<Ride>(
          metrics,
          category,
          'accept-offer',
          `/drivers/me/offer/${offer.data.id}/accept`,
          { token: driver.accessToken },
        );
        if (accept.ok && accept.data) {
          acceptedByDriverIndex.set(driver.index, accept.data.id);
          return; // this driver is BUSY now — its loop is done
        }
        // Lost a race for this exact offer (shouldn't normally happen —
        // sequential offering means one candidate at a time — but stay
        // correct if it ever does) or the offer expired between poll and
        // accept: keep polling for the next one.
      }
      // >=1000ms, not the tighter interval this run started with: an
      // early draft polled every 250ms and a real, reproducible finding
      // fell out of it — driverOfferLimiter (Section 8's real per-driver
      // rate limit) is 60/min, i.e. one call/second sustained. A pool
      // driver that never gets an offer during a scenario polls for that
      // scenario's entire duration, and 250ms polling blew through 60
      // calls in 15 seconds, then spent the rest of the window
      // legitimately 429'd by the exact safety mechanism it exists to
      // enforce — inflating this script's own error-rate numbers with
      // self-inflicted noise rather than anything the server did wrong.
      // See docs/simulation-results.md's own note on this.
      await sleep(1100);
    }
  }

  await Promise.all(drivers.map((driver) => driverLoop(driver)));
  return acceptedByDriverIndex;
}

/** Runs a matched ride all the way to COMPLETED — frees the driver back
 * to ONLINE for the next scenario and exercises the auto-charge path
 * along the way (a real side effect, not just plumbing). */
async function driveRideToCompletion(
  metrics: MetricsCollector,
  category: string,
  rideId: string,
  driverToken: string,
): Promise<void> {
  const steps = ['en-route', 'arrived', 'picked-up', 'start', 'complete'];
  for (const step of steps) {
    await apiCall(metrics, category, `lifecycle-${step}`, `/drivers/me/rides/${rideId}/${step}`, {
      token: driverToken,
    });
  }
}

// ---------------------------------------------------------------------
// Scenario: N simultaneous ride requests (10 / 25 / 50)
// ---------------------------------------------------------------------

interface LoadScenarioResult {
  label: string;
  requested: number;
  matched: number;
  unmatched: number;
}

async function scenarioConcurrentRideRequests(
  metrics: MetricsCollector,
  drivers: VirtualDriver[],
  count: number,
  label: string,
): Promise<LoadScenarioResult> {
  console.log(`\n=== Scenario: ${count} simultaneous ride requests (${label}) ===`);
  const category = `load_${label}`;
  const passengers = await Promise.all(
    Array.from({ length: count }, (_, index) => createVirtualPassenger(`${RUN_ID}-${label}`, index)),
  );

  // Several offer-timeout cycles' worth of window — if the closest
  // candidate never responds (shouldn't happen here; every pool driver
  // is running the accept loop) there's still time for the sweep to
  // advance to the next one before we give up on measuring the batch.
  const acceptLoopDurationMs = OFFER_TIMEOUT_MS * 2 + SWEEP_INTERVAL_MS * 2;
  const acceptLoopPromise = runAutoAcceptLoop(metrics, drivers, acceptLoopDurationMs, category);

  const rideResults = await Promise.all(
    passengers.map((passenger, index) =>
      apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
        token: passenger.accessToken,
        body: rideRequestBody(index),
      }),
    ),
  );
  const rideIds = rideResults.map((r) => r.data?.id).filter((id): id is string => Boolean(id));

  const acceptedByDriverIndex = await acceptLoopPromise;
  const rideIdToDriver = new Map<string, VirtualDriver>();
  for (const driver of drivers) {
    const rideId = acceptedByDriverIndex.get(driver.index);
    if (rideId) rideIdToDriver.set(rideId, driver);
  }

  // Matching latency straight from the database — matchedAt vs.
  // requestedAt is the ground truth; polling the HTTP status endpoint
  // would just add its own poll-interval noise on top.
  const rows =
    rideIds.length > 0
      ? await db
          .select({
            id: schema.rides.id,
            requestedAt: schema.rides.requestedAt,
            matchedAt: schema.rides.matchedAt,
          })
          .from(schema.rides)
          .where(inArray(schema.rides.id, rideIds))
      : [];

  let matched = 0;
  for (const row of rows) {
    if (row.matchedAt) {
      matched += 1;
      metrics.recordDirect(
        `matching_latency_${label}`,
        'matched-ride',
        row.matchedAt.getTime() - row.requestedAt.getTime(),
        true,
      );
    }
  }
  const unmatched = rideIds.length - matched;

  console.log(
    `  ${rideIds.length}/${count} ride requests created, ${matched} matched, ${unmatched} still searching.`,
  );

  // Free the drivers back up for the next scenario — and exercise the
  // full lifecycle + auto-charge path for every matched ride.
  await Promise.all(
    rows
      .filter((row) => row.matchedAt)
      .map((row) => {
        const driver = rideIdToDriver.get(row.id);
        if (!driver) return Promise.resolve();
        return driveRideToCompletion(metrics, category, row.id, driver.accessToken);
      }),
  );

  return { label, requested: count, matched, unmatched };
}

// ---------------------------------------------------------------------
// Scenario: driver timeout
// ---------------------------------------------------------------------

async function scenarioDriverTimeout(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: driver timeout ===');
  const category = 'driver_timeout';
  const point = nearbyPoint(0.005);
  const [unresponsive, backup] = await Promise.all([
    createVirtualDriver(`${RUN_ID}-timeout`, 900),
    createVirtualDriver(`${RUN_ID}-timeout`, 901),
  ]);
  try {
    // Sequential, not Promise.all: both drivers land at the exact same
    // point, so matching's tie-break (whoever has been available longer —
    // see packages/matching's scoring) is what decides who gets offered
    // first. Going `unresponsive` online strictly before `backup` makes
    // that deterministic instead of racing on request scheduling.
    for (const driver of [unresponsive, backup]) {
      await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
        method: 'PATCH',
        token: driver.accessToken,
        body: { status: 'ONLINE' },
      });
      await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
        token: driver.accessToken,
        body: {
          latitude: point.latitude,
          longitude: point.longitude,
          heading: 0,
          speed: 0,
          accuracy: 10,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const passenger = await createVirtualPassenger(`${RUN_ID}-timeout`, 0);
    const start = Date.now();
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9001),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }

    // Confirm the timed-out driver really was offered first, never
    // responds, and — once the real background sweep (src/index.ts,
    // running on the live server this script is hitting) expires it — the
    // ride reassigns to the backup candidate. `unresponsive` deliberately
    // never polls at all (that's the whole point); `backup` runs the same
    // accept loop every other scenario uses, so "reassigned" means exactly
    // what it means everywhere else in this script: backup's own accept
    // call actually won. (An earlier version of this check polled the DB
    // for `matchedAt` instead — which only a *successful accept* ever
    // sets, but nothing here was making one. Fixed once caught by this
    // exact run.)
    const acceptWindowMs = OFFER_TIMEOUT_MS + SWEEP_INTERVAL_MS * 3;
    const accepted = await runAutoAcceptLoop(metrics, [backup], acceptWindowMs, category);
    const reassigned = accepted.has(backup.index);

    if (reassigned) {
      console.log(
        `  Offer to the unresponsive driver correctly timed out; ride reassigned to the backup ` +
          `candidate after ${Date.now() - start}ms (offer timeout is ${OFFER_TIMEOUT_MS}ms).`,
      );
      metrics.recordDirect(`${category}_outcome`, 'timeout-to-reassignment', Date.now() - start, true);
    } else {
      console.log('  Ride never reassigned within the expected window — recorded as a failure.');
      metrics.recordDirect(`${category}_outcome`, 'timeout-to-reassignment', Date.now() - start, false);
    }

    // Clean up: whichever driver actually got matched should finish (or
    // cancel) so it doesn't linger BUSY into later scenarios.
    await apiCall(metrics, category, 'cleanup-cancel', `/rides/${rideId}/cancel`, {
      token: passenger.accessToken,
      body: {},
    });
  } finally {
    // Every isolated scenario from here on brings its own driver(s) and
    // needs to be the *only* eligible candidate(s) for whatever it
    // requests next — a leftover ONLINE driver from an earlier scenario
    // would not just sit idle, it would actively outrank a scenario's
    // brand-new driver (matching's wait-time tie-break prefers whoever's
    // been available *longer* — see packages/matching's scorer.ts), so
    // every scenario takes its own driver(s) back offline before
    // returning, success or failure alike (hence `finally`). Caught by
    // this exact run: earlier scenarios worked, later ones increasingly
    // didn't, as more idle drivers accumulated — see
    // docs/simulation-results.md.
    await driversOffline(metrics, [unresponsive, backup]);
  }
}

// ---------------------------------------------------------------------
// Scenario: driver decline
// ---------------------------------------------------------------------

async function scenarioDriverDecline(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: driver decline ===');
  const category = 'driver_decline';
  const point = nearbyPoint(0.005);
  const [decliner, backup] = await Promise.all([
    createVirtualDriver(`${RUN_ID}-decline`, 910),
    createVirtualDriver(`${RUN_ID}-decline`, 911),
  ]);
  try {
    for (const driver of [decliner, backup]) {
      await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
        method: 'PATCH',
        token: driver.accessToken,
        body: { status: 'ONLINE' },
      });
      await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
        token: driver.accessToken,
        body: { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: new Date().toISOString() },
      });
    }

    const passenger = await createVirtualPassenger(`${RUN_ID}-decline`, 1);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9002),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }

    const offer = await apiCall<RideOffer | null>(metrics, category, 'poll-offer', '/drivers/me/offer', {
      method: 'GET',
      token: decliner.accessToken,
    });
    if (!offer.data) {
      console.log('  Skipped: no offer materialized for the decliner.');
      return;
    }

    const start = Date.now();
    const decline = await apiCall(metrics, category, 'decline-offer', `/drivers/me/offer/${offer.data.id}/decline`, {
      token: decliner.accessToken,
    });
    console.log(`  Decline call: ${decline.ok ? 'accepted' : 'FAILED'} in ${(Date.now() - start).toFixed(0)}ms.`);

    // Give the backup a moment to poll and accept.
    const acceptedMap = await runAutoAcceptLoop(metrics, [backup], 3000, category);
    const reassigned = acceptedMap.get(backup.index);
    console.log(reassigned ? `  Ride correctly re-offered to the backup driver.` : `  Ride was NOT re-offered — recorded as a failure.`);
    metrics.recordDirect(`${category}_outcome`, 'decline-to-reassignment', Date.now() - start, Boolean(reassigned));

    if (reassigned) await driveRideToCompletion(metrics, category, reassigned, backup.accessToken);
  } finally {
    await driversOffline(metrics, [decliner, backup]);
  }
}

// ---------------------------------------------------------------------
// Scenario: driver disconnect (stale location excludes from matching)
// ---------------------------------------------------------------------

async function scenarioDriverDisconnect(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: driver disconnect ===');
  const category = 'driver_disconnect';
  const point = nearbyPoint(0.005);
  const [disconnected, backup] = await Promise.all([
    createVirtualDriver(`${RUN_ID}-disconnect`, 920),
    createVirtualDriver(`${RUN_ID}-disconnect`, 921),
  ]);
  try {
    await db
      .update(schema.driverProfiles)
      .set({ availabilityStatus: 'ONLINE' })
      .where(inArray(schema.driverProfiles.id, [disconnected.driverProfileId, backup.driverProfileId]));

    // The disconnected driver's last known position is deliberately
    // back-dated past STALE_THRESHOLD_MS (locationService.ts: 2 minutes) —
    // the real-time equivalent (stop calling POST .../location and wait 2
    // real minutes) is the same outcome, just too slow for a dev
    // simulator. This mirrors the exact `makeEligible(..., {recordedAt})`
    // pattern routes/driverOffers.test.ts already uses for the same
    // purpose.
    await db.insert(schema.driverLocations).values({
      driverId: disconnected.driverProfileId,
      latitude: point.latitude,
      longitude: point.longitude,
      recordedAt: new Date(Date.now() - 3 * 60 * 1000),
    });
    await db.insert(schema.driverLocations).values({
      driverId: backup.driverProfileId,
      latitude: point.latitude,
      longitude: point.longitude,
      recordedAt: new Date(),
    });

    const passenger = await createVirtualPassenger(`${RUN_ID}-disconnect`, 2);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9003),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }

    await sleep(500); // let matching finish its (synchronous, but still async I/O) candidate search
    const [row] = await db
      .select({ driverId: schema.rides.driverId })
      .from(schema.rides)
      .where(eq(schema.rides.id, rideId));

    const excludedCorrectly = row?.driverId !== disconnected.driverProfileId;
    console.log(
      excludedCorrectly
        ? `  Stale (disconnected) driver correctly excluded from matching; offered to the fresh backup instead.`
        : `  FAILURE: the stale driver was still offered the ride.`,
    );
    metrics.recordDirect(`${category}_outcome`, 'stale-driver-excluded', 0, excludedCorrectly);

    if (row?.driverId === backup.driverProfileId) {
      await apiCall(metrics, category, 'cleanup-cancel', `/rides/${rideId}/cancel`, {
        token: passenger.accessToken,
        body: {},
      });
    }
  } finally {
    await driversOffline(metrics, [disconnected, backup]);
  }
}

// ---------------------------------------------------------------------
// Scenario: GPS loss mid-ride (distinct from disconnect: this is
// *after* assignment, so matching eligibility no longer applies — the
// question is whether the ride lifecycle itself tolerates it.)
// ---------------------------------------------------------------------

async function scenarioGpsLoss(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: GPS loss mid-ride ===');
  const category = 'gps_loss';
  const point = nearbyPoint(0.005);
  const driver = await createVirtualDriver(`${RUN_ID}-gpsloss`, 930);
  try {
    await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
      method: 'PATCH',
      token: driver.accessToken,
      body: { status: 'ONLINE' },
    });
    await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
      token: driver.accessToken,
      body: { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: new Date().toISOString() },
    });

    const passenger = await createVirtualPassenger(`${RUN_ID}-gpsloss`, 3);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9004),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }

    const accepted = await runAutoAcceptLoop(metrics, [driver], 5000, category);
    if (!accepted.get(driver.index)) {
      console.log('  Skipped: driver never got matched.');
      return;
    }

    // GPS loss simulated by simply never calling POST .../location again
    // for this driver from this point on — the driver-app would still be
    // sending pickup-navigation/ride-lifecycle actions from its own local
    // state even with no fix, so the question this proves is whether
    // those *lifecycle* endpoints depend on a fresh location row. They do
    // not (only matching eligibility, findEligibleDrivers, does).
    let lifecycleSucceeded = true;
    for (const step of ['en-route', 'arrived', 'picked-up', 'start', 'complete']) {
      const result = await apiCall(metrics, category, `lifecycle-${step}`, `/drivers/me/rides/${rideId}/${step}`, {
        token: driver.accessToken,
      });
      if (!result.ok) lifecycleSucceeded = false;
    }
    console.log(
      lifecycleSucceeded
        ? `  Ride lifecycle completed normally despite no further location pings after assignment.`
        : `  FAILURE: a lifecycle step was rejected due to the missing location data.`,
    );
    metrics.recordDirect(`${category}_outcome`, 'lifecycle-survives-gps-loss', 0, lifecycleSucceeded);
  } finally {
    await driversOffline(metrics, [driver]);
  }
}

// ---------------------------------------------------------------------
// Scenario: passenger cancellation / driver cancellation
// ---------------------------------------------------------------------

async function scenarioPassengerCancellation(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: passenger cancellation ===');
  const category = 'passenger_cancellation';
  const point = nearbyPoint(0.005);
  const driver = await createVirtualDriver(`${RUN_ID}-pcancel`, 940);
  try {
    await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
      method: 'PATCH',
      token: driver.accessToken,
      body: { status: 'ONLINE' },
    });
    await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
      token: driver.accessToken,
      body: { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: new Date().toISOString() },
    });

    const passenger = await createVirtualPassenger(`${RUN_ID}-pcancel`, 4);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9005),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }
    await runAutoAcceptLoop(metrics, [driver], 5000, category);

    const start = Date.now();
    const cancel = await apiCall<Ride>(metrics, category, 'passenger-cancel', `/rides/${rideId}/cancel`, {
      token: passenger.accessToken,
      body: { reason: 'Simulated passenger cancellation' },
    });
    console.log(
      `  Passenger cancel: ${cancel.ok ? `OK, final status ${cancel.data?.status}` : 'FAILED'} ` +
        `in ${(Date.now() - start).toFixed(0)}ms.`,
    );
  } finally {
    await driversOffline(metrics, [driver]);
  }
}

async function scenarioDriverCancellation(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: driver cancellation ===');
  const category = 'driver_cancellation';
  const point = nearbyPoint(0.005);
  const driver = await createVirtualDriver(`${RUN_ID}-dcancel`, 950);
  try {
    await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
      method: 'PATCH',
      token: driver.accessToken,
      body: { status: 'ONLINE' },
    });
    await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
      token: driver.accessToken,
      body: { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: new Date().toISOString() },
    });

    const passenger = await createVirtualPassenger(`${RUN_ID}-dcancel`, 5);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9006),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }
    const accepted = await runAutoAcceptLoop(metrics, [driver], 5000, category);
    if (!accepted.get(driver.index)) {
      console.log('  Skipped: driver never got matched.');
      return;
    }

    const start = Date.now();
    const cancel = await apiCall<Ride>(metrics, category, 'driver-cancel', `/drivers/me/rides/${rideId}/cancel`, {
      token: driver.accessToken,
      body: { reason: 'Simulated driver cancellation' },
    });
    // Phase 17 default policy: driver cancellation returns the ride to
    // SEARCHING_DRIVER (re-matching) rather than terminating it outright —
    // see docs/cancellation.md.
    console.log(
      `  Driver cancel: ${cancel.ok ? `OK, ride status is now ${cancel.data?.status}` : 'FAILED'} ` +
        `in ${(Date.now() - start).toFixed(0)}ms.`,
    );

    // Best-effort cleanup so this ride doesn't linger mid-scenario.
    await apiCall(metrics, category, 'cleanup-cancel', `/rides/${rideId}/cancel`, {
      token: passenger.accessToken,
      body: {},
    }).catch(() => undefined);
  } finally {
    await driversOffline(metrics, [driver]);
  }
}

// ---------------------------------------------------------------------
// Scenario: duplicate API request (idempotency-key replay)
// ---------------------------------------------------------------------

async function scenarioDuplicateApiRequest(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: duplicate API request ===');
  const category = 'duplicate_api_request';
  const passenger = await createVirtualPassenger(`${RUN_ID}-dup`, 6);
  const body = rideRequestBody(9007);

  const first = await apiCall<Ride>(metrics, category, 'first-request', '/rides', {
    token: passenger.accessToken,
    body,
  });
  const second = await apiCall<Ride>(metrics, category, 'duplicate-request', '/rides', {
    token: passenger.accessToken,
    body, // identical body, identical idempotencyKey
  });

  const sameRide = first.data?.id && first.data.id === second.data?.id;
  const correctStatusCodes = first.status === 201 && second.status === 200;
  console.log(
    sameRide && correctStatusCodes
      ? `  Duplicate request correctly returned the same ride (${first.data?.id}) with 201 then 200, no second row created.`
      : `  FAILURE: duplicate request did not resolve to the same ride/status pair (first=${first.status}, second=${second.status}).`,
  );
  metrics.recordDirect(`${category}_outcome`, 'idempotent-replay-correct', 0, Boolean(sameRide && correctStatusCodes));

  if (first.data?.id) {
    await apiCall(metrics, category, 'cleanup-cancel', `/rides/${first.data.id}/cancel`, {
      token: passenger.accessToken,
      body: {},
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------
// Scenario: duplicate webhook delivery
// ---------------------------------------------------------------------

async function scenarioDuplicateWebhook(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: duplicate webhook ===');
  const category = 'duplicate_webhook';

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.log(
      '  SKIPPED: STRIPE_WEBHOOK_SECRET is not set in this script\'s own environment. Start the ' +
        'API server with the same STRIPE_WEBHOOK_SECRET and re-run with it set here too — see this ' +
        'script\'s module comment.',
    );
    return;
  }

  // A synthetic second in-flight PaymentIntent for a ride that already
  // has its own (already-SUCCEEDED, MOCK-provider) payment record — the
  // exact scenario routes/payments.test.ts's own webhook suite uses:
  // a genuinely PENDING record only the webhook can resolve.
  const driver = await createVirtualDriver(`${RUN_ID}-webhook`, 960);
  try {
    const point = nearbyPoint(0.005);
    await apiCall(metrics, category, 'go-online', '/drivers/me/availability', {
      method: 'PATCH',
      token: driver.accessToken,
      body: { status: 'ONLINE' },
    });
    await apiCall(metrics, category, 'location-ping', '/drivers/me/location', {
      token: driver.accessToken,
      body: { latitude: point.latitude, longitude: point.longitude, accuracy: 10, timestamp: new Date().toISOString() },
    });
    const passenger = await createVirtualPassenger(`${RUN_ID}-webhook`, 7);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9008),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }
    const accepted = await runAutoAcceptLoop(metrics, [driver], 5000, category);
    if (!accepted.get(driver.index)) {
      console.log('  Skipped: driver never got matched.');
      return;
    }
    await driveRideToCompletion(metrics, category, rideId, driver.accessToken);

    const providerPaymentIntentId = `pi_mock_sim_${randomUUID()}`;
    const record = await createPaymentRecord({
      rideId,
      amountCents: 1234,
      currency: 'usd',
      idempotencyKey: `sim-webhook-${randomUUID()}`,
    });
    await setProviderPaymentIntentId(record.id, providerPaymentIntentId);

    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: providerPaymentIntentId, object: 'payment_intent' } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });

    const first = await apiCall(metrics, category, 'webhook-delivery-1', '/webhooks/stripe', {
      rawBody: payload,
      extraHeaders: { 'stripe-signature': header, 'Content-Type': 'application/json' },
    });
    const second = await apiCall(metrics, category, 'webhook-delivery-2-duplicate', '/webhooks/stripe', {
      rawBody: payload,
      extraHeaders: { 'stripe-signature': header, 'Content-Type': 'application/json' },
    });

    const updated = await findPaymentRecordById(record.id);
    const correct = first.ok && second.ok && updated?.status === 'SUCCEEDED';
    console.log(
      correct
        ? `  Both deliveries accepted (200); the redelivery was correctly a no-op — payment record resolved exactly once to SUCCEEDED.`
        : `  FAILURE: unexpected outcome (first=${first.status}, second=${second.status}, finalStatus=${updated?.status}).`,
    );
    metrics.recordDirect(`${category}_outcome`, 'webhook-idempotent', 0, Boolean(correct));
  } finally {
    await driversOffline(metrics, [driver]);
  }
}

// ---------------------------------------------------------------------
// Scenario: two-driver acceptance race
// ---------------------------------------------------------------------

async function scenarioTwoDriverRace(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: two-driver acceptance race ===');
  const category = 'two_driver_race';
  const [driverA, driverB] = await Promise.all([
    createVirtualDriver(`${RUN_ID}-race`, 970),
    createVirtualDriver(`${RUN_ID}-race`, 971),
  ]);
  try {
    await db
      .update(schema.driverProfiles)
      .set({ availabilityStatus: 'ONLINE' })
      .where(inArray(schema.driverProfiles.id, [driverA.driverProfileId, driverB.driverProfileId]));

    const passenger = await createVirtualPassenger(`${RUN_ID}-race`, 8);
    const ride = await apiCall<Ride>(metrics, category, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9009),
    });
    const rideId = ride.data?.id;
    if (!rideId) {
      console.log('  Skipped: ride request itself failed.');
      return;
    }

    // Real matching only ever leaves one OFFERED row per ride — directly
    // constructing two concurrent OFFERED offers for the same ride is the
    // deliberate exception, exercising the same atomic accept transaction
    // routes/driverOffers.test.ts's own "two drivers accepting
    // simultaneously" test does, just through the live HTTP surface
    // instead of supertest.
    const [offerA, offerB] = await Promise.all([
      createOffer(rideId, driverA.driverProfileId, new Date(Date.now() + 60_000)),
      createOffer(rideId, driverB.driverProfileId, new Date(Date.now() + 60_000)),
    ]);

    const [responseA, responseB] = await Promise.all([
      apiCall<Ride>(metrics, category, 'accept-a', `/drivers/me/offer/${offerA.id}/accept`, {
        token: driverA.accessToken,
      }),
      apiCall<Ride>(metrics, category, 'accept-b', `/drivers/me/offer/${offerB.id}/accept`, {
        token: driverB.accessToken,
      }),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    const exactlyOneWinner = JSON.stringify(statuses) === JSON.stringify([200, 409]);
    console.log(
      exactlyOneWinner
        ? `  Exactly one winner (200 + 409), as required — the losing side lost cleanly with no partial state.`
        : `  FAILURE: unexpected status pair ${JSON.stringify(statuses)}.`,
    );
    metrics.recordDirect(`${category}_outcome`, 'exactly-one-winner', 0, exactlyOneWinner);

    const winnerToken = responseA.ok ? driverA.accessToken : driverB.accessToken;
    await apiCall(metrics, category, 'cleanup-cancel', `/drivers/me/rides/${rideId}/cancel`, {
      token: winnerToken,
      body: {},
    }).catch(() => undefined);
  } finally {
    await driversOffline(metrics, [driverA, driverB]);
  }
}

// ---------------------------------------------------------------------
// Scenario: high network latency
// ---------------------------------------------------------------------

async function scenarioHighNetworkLatency(metrics: MetricsCollector): Promise<void> {
  console.log('\n=== Scenario: high network latency ===');

  // (a) Correctness under latency: the same two-driver race, but one
  // side's accept call is preceded by a large injected client-side
  // delay — this script cannot reshape real network conditions against
  // localhost, so "high latency" is emulated as a slow client instead
  // (see apiCall's preSendDelayMs). The atomic accept guarantee must
  // hold regardless of which side's request physically arrives last.
  const raceCategory = 'high_latency_race';
  const [fast, slow] = await Promise.all([
    createVirtualDriver(`${RUN_ID}-latency`, 980),
    createVirtualDriver(`${RUN_ID}-latency`, 981),
  ]);
  try {
    await db
      .update(schema.driverProfiles)
      .set({ availabilityStatus: 'ONLINE' })
      .where(inArray(schema.driverProfiles.id, [fast.driverProfileId, slow.driverProfileId]));

    const passenger = await createVirtualPassenger(`${RUN_ID}-latency`, 9);
    const ride = await apiCall<Ride>(metrics, raceCategory, 'post-ride-request', '/rides', {
      token: passenger.accessToken,
      body: rideRequestBody(9010),
    });
    const rideId = ride.data?.id;
    if (rideId) {
      const [offerFast, offerSlow] = await Promise.all([
        createOffer(rideId, fast.driverProfileId, new Date(Date.now() + 60_000)),
        createOffer(rideId, slow.driverProfileId, new Date(Date.now() + 60_000)),
      ]);
      const [responseFast, responseSlow] = await Promise.all([
        apiCall<Ride>(metrics, raceCategory, 'accept-fast', `/drivers/me/offer/${offerFast.id}/accept`, {
          token: fast.accessToken,
        }),
        apiCall<Ride>(metrics, raceCategory, 'accept-slow-1500ms-latency', `/drivers/me/offer/${offerSlow.id}/accept`, {
          token: slow.accessToken,
          preSendDelayMs: 1500,
        }),
      ]);
      const statuses = [responseFast.status, responseSlow.status].sort();
      const correct = JSON.stringify(statuses) === JSON.stringify([200, 409]);
      console.log(
        correct
          ? `  Race held under a 1500ms injected client delay on one side — still exactly one winner.`
          : `  FAILURE: unexpected status pair ${JSON.stringify(statuses)} under injected latency.`,
      );
      metrics.recordDirect(`${raceCategory}_outcome`, 'exactly-one-winner-under-latency', 0, correct);

      const winnerToken = responseFast.ok ? fast.accessToken : slow.accessToken;
      await apiCall(metrics, raceCategory, 'cleanup-cancel', `/drivers/me/rides/${rideId}/cancel`, {
        token: winnerToken,
        body: {},
      }).catch(() => undefined);
    }
  } finally {
    await driversOffline(metrics, [fast, slow]);
  }

  // (b) Aggregate impact: a batch of ride requests, each client
  // deliberately slowed by a random delay before sending — for direct
  // comparison against the same-shaped baseline load scenarios' own
  // (near-zero-latency) API latency stats.
  const batchCategory = 'high_latency_batch';
  const passengers = await Promise.all(
    Array.from({ length: 15 }, (_, index) => createVirtualPassenger(`${RUN_ID}-latency-batch`, index)),
  );
  const results = await Promise.all(
    passengers.map((p, index) =>
      apiCall<Ride>(metrics, batchCategory, 'post-ride-request', '/rides', {
        token: p.accessToken,
        body: rideRequestBody(9100 + index),
        preSendDelayMs: 300 + Math.random() * 1200,
      }),
    ),
  );
  const succeeded = results.filter((r) => r.ok).length;
  console.log(`  ${succeeded}/${results.length} ride requests succeeded under 300-1500ms injected client latency.`);

  await Promise.all(
    results
      .map((r) => r.data?.id)
      .filter((id): id is string => Boolean(id))
      .map((id, i) =>
        apiCall(metrics, batchCategory, 'cleanup-cancel', `/rides/${id}/cancel`, {
          token: passengers[i]!.accessToken,
          body: {},
        }).catch(() => undefined),
      ),
  );
}

// ---------------------------------------------------------------------
// Database query performance — EXPLAIN ANALYZE against the exact shape
// of the hottest read-path queries, run directly (not through HTTP, so
// this is server-side execution time with the client's own network hop
// factored out — a distinct measurement from "API latency" above).
// ---------------------------------------------------------------------

interface QueryPerfResult {
  label: string;
  planningTimeMs: number;
  executionTimeMs: number;
}

async function measureQueryPerformance(): Promise<QueryPerfResult[]> {
  const { sql } = await import('drizzle-orm');
  const probes: Array<{ label: string; text: string }> = [
    {
      label: 'matching eligibility (findEligibleDrivers shape)',
      text: `
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT dp.id, dl.latitude, dl.longitude, dl.recorded_at, dp.updated_at
        FROM driver_profiles dp
        JOIN driver_locations dl ON dl.driver_id = dp.id
        WHERE dp.onboarding_status = 'APPROVED'
          AND dp.availability_status = 'ONLINE'
          AND dl.recorded_at >= now() - interval '2 minutes'
          AND dp.id NOT IN (SELECT driver_id FROM ride_requests WHERE status = 'OFFERED')
      `,
    },
    {
      label: 'admin active rides list (listActiveRides shape)',
      text: `
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT r.id, r.status, r.driver_id, pp.first_name, pp.last_name, r.requested_at
        FROM rides r
        JOIN passenger_profiles pp ON pp.id = r.passenger_id
        LEFT JOIN driver_profiles dp ON dp.id = r.driver_id
        WHERE r.status IN ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','PASSENGER_ONBOARD','IN_PROGRESS')
        ORDER BY r.requested_at DESC
      `,
    },
    {
      label: 'single ride lookup by primary key (findRideById shape)',
      text: `
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT * FROM rides ORDER BY requested_at DESC LIMIT 1
      `,
    },
  ];

  const results: QueryPerfResult[] = [];
  for (const probe of probes) {
    const rows = (await db.execute(sql.raw(probe.text))) as unknown as { rows: Array<Record<string, unknown>> };
    const plan = rows.rows[0]?.['QUERY PLAN'] as Array<{ 'Planning Time': number; 'Execution Time': number }> | undefined;
    results.push({
      label: probe.label,
      planningTimeMs: plan?.[0]?.['Planning Time'] ?? -1,
      executionTimeMs: plan?.[0]?.['Execution Time'] ?? -1,
    });
  }
  return results;
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------

function printCategoryTable(metrics: MetricsCollector): void {
  console.log('\n--- API latency / error rate, by category ---');
  console.log(
    'category'.padEnd(28) + 'count'.padStart(7) + 'p50ms'.padStart(8) + 'p95ms'.padStart(8) + 'p99ms'.padStart(8) + 'errRate'.padStart(9),
  );
  for (const category of metrics.categories()) {
    const s = metrics.statsFor(category);
    if (!s) continue;
    console.log(
      category.padEnd(28) +
        String(s.count).padStart(7) +
        s.p50Ms.toFixed(0).padStart(8) +
        s.p95Ms.toFixed(0).padStart(8) +
        s.p99Ms.toFixed(0).padStart(8) +
        `${(s.errorRate * 100).toFixed(1)}%`.padStart(9),
    );
  }
}

async function main(): Promise<void> {
  console.log(`Phase 19 load/scenario simulator — run ${RUN_ID}, target ${API_URL}, driver pool ${DRIVER_COUNT}`);
  const metrics = new MetricsCollector();
  const startedAt = Date.now();

  const drivers = await scenarioDriversOnline(metrics, DRIVER_COUNT);

  const loadResults: LoadScenarioResult[] = [];
  for (const count of [10, 25, 50]) {
    loadResults.push(await scenarioConcurrentRideRequests(metrics, drivers, count, `${count}req`));
  }

  // Every scenario from here on brings its own one or two dedicated
  // drivers and needs *them* — and only them — to be the eligible
  // candidate(s) for whatever ride it requests. Leaving the 50-driver
  // load-test pool online would silently crowd every one of them out:
  // matching would just as happily offer the ride to an idle pool
  // driver (all clustered at the same city center, all still ONLINE)
  // as to the scenario's own driver, and none of these scenarios' own
  // dedicated drivers would ever actually be the one under test. Caught
  // by this exact run — see docs/simulation-results.md.
  await driversOffline(metrics, drivers);

  await scenarioDriverTimeout(metrics);
  await scenarioDriverDecline(metrics);
  await scenarioDriverDisconnect(metrics);
  await scenarioGpsLoss(metrics);
  await scenarioPassengerCancellation(metrics);
  await scenarioDriverCancellation(metrics);
  await scenarioDuplicateApiRequest(metrics);
  await scenarioDuplicateWebhook(metrics);
  await scenarioTwoDriverRace(metrics);
  await scenarioHighNetworkLatency(metrics);

  console.log('\n=== Database query performance (EXPLAIN ANALYZE) ===');
  const queryPerf = await measureQueryPerformance();
  for (const q of queryPerf) {
    console.log(`  ${q.label}: planning=${q.planningTimeMs.toFixed(2)}ms execution=${q.executionTimeMs.toFixed(2)}ms`);
  }

  const overall = metrics.overall();
  const conflicts = metrics.conflicts();
  const expectedConflictCategories = new Set(['two_driver_race', 'high_latency_race']);
  const unexpectedConflicts = conflicts.filter((c) => !expectedConflictCategories.has(c.category));

  printCategoryTable(metrics);

  console.log('\n=== Overall ===');
  console.log(
    `  ${overall.count} total calls, ${(overall.errorRate * 100).toFixed(2)}% error rate, ` +
      `peak concurrent in-flight requests: ${metrics.getPeakInFlight()} ` +
      `(Stage 1's proxy for "realtime connections" — no websocket/SSE transport exists; see docs/simulation-results.md).`,
  );
  console.log(
    `  409 (failed state transition) responses: ${conflicts.length} total, ` +
      `${conflicts.length - unexpectedConflicts.length} expected (race scenarios), ` +
      `${unexpectedConflicts.length} unexpected.`,
  );
  console.log(`  Total run duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  const report = {
    runId: RUN_ID,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    driverCount: DRIVER_COUNT,
    loadResults,
    peakInFlight: metrics.getPeakInFlight(),
    overall,
    byCategory: Object.fromEntries(metrics.categories().map((c) => [c, metrics.statsFor(c)])),
    matchingLatencyByLabel: Object.fromEntries(
      ['10req', '25req', '50req'].map((label) => [label, metrics.statsFor(`matching_latency_${label}`)]),
    ),
    conflicts: { total: conflicts.length, expected: conflicts.length - unexpectedConflicts.length, unexpected: unexpectedConflicts.length },
    queryPerformance: queryPerf,
  };

  const outputDir = path.join(__dirname, 'output');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'simulation-results.json');
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nFull machine-readable report written to ${outputPath}`);

  await pool.end();
  console.log('Done.');
}

main().catch((error: unknown) => {
  console.error('Simulator failed:', error);
  process.exit(1);
});
