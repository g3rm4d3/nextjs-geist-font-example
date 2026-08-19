/**
 * Section 6/Phase 6: "Create simulator capable of moving 50 virtual
 * drivers." A standalone dev tool, not part of the running API process —
 * it drives the real HTTP location/availability surface exactly like a
 * fleet of driver apps would, so it exercises the same validation/
 * throttling/staleness code paths the real driver app does.
 *
 * Driver identities themselves are created directly in the database
 * (users + driver_profiles rows, already APPROVED) rather than through
 * POST /auth/drivers/register, and their access tokens are signed
 * directly with the same signAccessToken() the real login flow uses,
 * rather than through POST /auth/login. This is deliberate, not a
 * shortcut of convenience: `registerLimiter` (10/hour) and
 * `loginLimiter` (20/15min) exist specifically to stop a burst of
 * account creation/login from one source, and a 50-driver simulator
 * *is* exactly that burst — routing it through those endpoints would
 * mean either weakening real anti-abuse limits or the simulator failing
 * outright (both tried; both wrong). Registration and login already
 * have their own dedicated tests (Phase 2); this tool's job is
 * location-ingest at scale, so it goes straight to the identities and
 * exercises only the endpoints Phase 6 is actually about:
 * PATCH /drivers/me/availability and POST /drivers/me/location.
 *
 * Usage (from apps/api, with a running API server and a migrated
 * database):
 *
 *   npm run simulate:drivers
 *
 * Configurable via env vars (all optional):
 *   SIMULATOR_API_URL      default http://localhost:4000
 *   SIMULATOR_DRIVER_COUNT default 50
 *   SIMULATOR_TICK_MS      default 3000
 *   SIMULATOR_DURATION_MS  default 30000 (0 = run until Ctrl+C)
 *
 * Reuses apps/api's own db client/pool (src/db/client.ts, src/db/pool.ts)
 * rather than duplicating them — this script lives inside apps/api, not
 * as a standalone package script, so it can. Identity creation (users +
 * driver_profiles rows, signed access token) and the shared city-center
 * constant live in simulatorSupport.ts, alongside Phase 19's simulate.ts —
 * see that module's own comment for why. Run via
 * `npm run simulate:drivers --workspace=apps/api` so apps/api/.env's
 * DATABASE_URL and JWT secret (src/config/env.ts validates the whole
 * set) are picked up.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db/pool';
import {
  createVirtualDriver as createVirtualDriverIdentity,
  randomOffset,
  sleep,
} from './simulatorSupport';

const API_URL = process.env.SIMULATOR_API_URL ?? 'http://localhost:4000';
const DRIVER_COUNT = Number(process.env.SIMULATOR_DRIVER_COUNT ?? 50);
const TICK_MS = Number(process.env.SIMULATOR_TICK_MS ?? 3000);
const DURATION_MS = Number(process.env.SIMULATOR_DURATION_MS ?? 30000);

const DRIFT_DEGREES = 0.0015; // per-tick random-walk step

interface VirtualDriver {
  index: number;
  accessToken: string;
  latitude: number;
  longitude: number;
}

/**
 * Thin wrapper over simulatorSupport's createVirtualDriver: this script
 * only needs {index, accessToken, latitude, longitude} to run its
 * ping loop, not the full identity (userId/driverProfileId) simulate.ts
 * needs to cross-reference matching/accept state.
 */
async function createVirtualDriver(runId: string, index: number): Promise<VirtualDriver> {
  const identity = await createVirtualDriverIdentity(runId, index);
  return {
    index: identity.index,
    accessToken: identity.accessToken,
    latitude: identity.latitude,
    longitude: identity.longitude,
  };
}

async function goOnline(accessToken: string): Promise<void> {
  const response = await fetch(`${API_URL}/drivers/me/availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ status: 'ONLINE' }),
  });
  if (!response.ok) {
    throw new Error(`Failed to go online (${response.status})`);
  }
}

async function goOffline(accessToken: string): Promise<void> {
  try {
    await fetch(`${API_URL}/drivers/me/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: 'OFFLINE' }),
    });
  } catch {
    // Best-effort on the way out — nothing useful to do with a failure here.
  }
}

async function pingLocation(driver: VirtualDriver): Promise<boolean> {
  driver.latitude += randomOffset(DRIFT_DEGREES);
  driver.longitude += randomOffset(DRIFT_DEGREES);

  const response = await fetch(`${API_URL}/drivers/me/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driver.accessToken}` },
    body: JSON.stringify({
      latitude: driver.latitude,
      longitude: driver.longitude,
      heading: Math.random() * 360,
      speed: 4 + Math.random() * 10,
      accuracy: 10,
      timestamp: new Date().toISOString(),
    }),
  });

  return response.ok;
}

async function main(): Promise<void> {
  console.log(
    `Simulating ${DRIVER_COUNT} virtual drivers against ${API_URL} ` +
      `(tick every ${TICK_MS}ms, ${DURATION_MS > 0 ? `${DURATION_MS}ms total` : 'until Ctrl+C'})`,
  );

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;

  console.log('Creating virtual drivers (direct DB insert, already APPROVED)...');
  const drivers: VirtualDriver[] = await Promise.all(
    Array.from({ length: DRIVER_COUNT }, (_, index) => createVirtualDriver(runId, index)),
  );

  console.log('Going online (real PATCH /drivers/me/availability)...');
  await Promise.all(drivers.map((driver) => goOnline(driver.accessToken)));

  let stopped = false;
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT — finishing current tick, then shutting down...');
    stopped = true;
  });

  const totalTicks = DURATION_MS > 0 ? Math.ceil(DURATION_MS / TICK_MS) : Infinity;
  let tick = 0;

  while (!stopped && tick < totalTicks) {
    const results = await Promise.all(drivers.map((driver) => pingLocation(driver)));
    const succeeded = results.filter(Boolean).length;
    tick += 1;
    const label = totalTicks === Infinity ? `${tick}` : `${tick}/${totalTicks}`;
    console.log(`tick ${label}: ${succeeded}/${drivers.length} pings ok`);

    if (stopped || tick >= totalTicks) break;
    await sleep(TICK_MS);
  }

  console.log('Going offline...');
  await Promise.all(drivers.map((driver) => goOffline(driver.accessToken)));

  await pool.end();
  console.log('Done.');
}

main().catch((error: unknown) => {
  console.error('Simulator failed:', error);
  process.exit(1);
});
