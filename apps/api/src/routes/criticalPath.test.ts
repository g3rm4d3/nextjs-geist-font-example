import { randomUUID } from 'node:crypto';
import { hashPassword } from '@rideshare/auth';
import { schema } from '@rideshare/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { db } from '../db/client';
import { pool } from '../db/pool';

const app = createApp();

/**
 * PHASE 21/24 — "Critical E2E" / "Stage 1 Final Validation." Two phases,
 * one test: Phase 21 asked for one literal end-to-end story (passenger
 * registers -> ... -> admin inspects); Phase 24's own 24-step "required
 * scenario" is the same story again, just numbered and slightly more
 * granular (it splits out "passenger receives driver information" and
 * "platform TEST revenue is recorded" as their own steps, both added to
 * this file in Phase 24 rather than duplicated into a second test file).
 * Every one of the 24 steps below maps onto a concrete assertion in this
 * one continuous flow:
 *
 *   1.  Passenger opens Passenger App        — client-side; out of scope for
 *                                               a server-side test by nature.
 *   2.  Passenger authenticates              — POST /auth/passengers/register
 *   3.  Passenger selects pickup             — the `pickup` coordinate (see
 *                                               note below)
 *   4.  Passenger selects destination        — the `destination` coordinate
 *   5.  Backend calculates estimate          — POST /pricing/estimate
 *   6.  Passenger requests ride              — POST /rides
 *   7.  Matching Engine searches drivers     — implicit: startMatching runs
 *                                               synchronously inside POST
 *                                               /rides; the very next step
 *                                               (an offer existing) is its
 *                                               observable proof
 *   8.  Driver receives offer (separate app) — GET /drivers/me/offer, using
 *                                               the *driver's own* token —
 *                                               never the passenger's,
 *                                               proving these are genuinely
 *                                               separate, role-scoped
 *                                               sessions, not shared state
 *   9.  Driver accepts                       — POST /drivers/me/offer/:id/
 *                                               accept
 *   10. Passenger receives driver info       — GET /rides/:id/driver,
 *                                               immediately after acceptance
 *   11. Driver navigates to pickup           — POST .../en-route
 *   12. Passenger sees driver location       — GET /rides/:id/driver during
 *                                               travel (firstName) and again
 *                                               mid-ride (location non-null)
 *   13. Driver marks arrival                 — POST .../arrived
 *   14. Passenger boards                     — POST .../picked-up
 *                                               (PASSENGER_ONBOARD)
 *   15. Driver starts ride                   — POST .../start (IN_PROGRESS)
 *   16. Realtime tracking operates           — two more location pings while
 *                                               IN_PROGRESS, then confirmed
 *                                               visible via GET .../driver
 *   17. Driver completes ride                — POST .../complete
 *   18. Backend calculates final TEST fare   — `finalFareCents` on that same
 *                                               response
 *   19. Stripe TEST payment processes        — GET /rides/:id/payment,
 *                                               status SUCCEEDED
 *   20. Driver TEST earnings are recorded    — GET /drivers/me/earnings/
 *                                               summary + history
 *   21. Platform TEST revenue is recorded    — GET /admin/revenue
 *   22. Passenger rates driver               — POST /rides/:id/rating
 *   23. Driver rates passenger               — POST /drivers/me/rides/:id/
 *                                               rating
 *   24. Admin App displays entire operation  — GET /admin/rides/:id,
 *                                               /admin/payments,
 *                                               /admin/ratings, /admin/
 *                                               revenue, using a real ADMIN
 *                                               session distinct from both
 *                                               the passenger's and driver's
 *
 * Every one of these steps already has its own dedicated, focused test
 * coverage scattered across this directory (rides.test.ts,
 * driverOffers.test.ts, rideLifecycle.test.ts, realtimeTracking.test.ts,
 * payments.test.ts, earnings.test.ts, ratings.test.ts,
 * adminInspect.test.ts) — this file's job is different: it is the one
 * place the *entire* chain runs as a single, continuous story against
 * one real ride, so a regression that breaks the seam between two
 * phases (e.g. a field earlier phases relied on getting silently
 * renamed) fails here even if each side's own unit-scoped test still
 * passes in isolation. "All critical tests must pass" (Phase 21's own
 * words) is this file, specifically — and it is what Phase 24's
 * required demonstration (see docs/stage1-demonstration.md) points to
 * as its evidence, rather than a second, hand-run walkthrough of the
 * same story.
 *
 * "Chooses pickup" / "chooses destination" have no server-side step of
 * their own — that's a client-side map interaction (see
 * apps/passenger-app's DestinationSearchScreen/RoutePreviewScreen) that
 * produces the coordinates POST /pricing/estimate and POST /rides both
 * take as input; this test represents that choice as the literal
 * coordinate pair a passenger client would have already produced by the
 * time it calls either endpoint.
 */

const PRICING_CONFIG = {
  baseFareCents: 250,
  perMileRateCents: 150,
  perMinuteRateCents: 25,
  minimumFareCents: 500,
  bookingFeeCents: 200,
  cancellationFeeCents: 500,
  platformCommissionPercentage: '20.00',
};

let insertedConfigId: string;

beforeAll(async () => {
  await db.update(schema.pricingConfigs).set({ active: false }).where(eq(schema.pricingConfigs.active, true));
  const [row] = await db
    .insert(schema.pricingConfigs)
    .values({ name: `critical-path-test-${randomUUID()}`, active: true, ...PRICING_CONFIG })
    .returning({ id: schema.pricingConfigs.id });
  if (!row) throw new Error('Failed to insert test pricing config');
  insertedConfigId = row.id;
});

afterAll(async () => {
  await db.delete(schema.pricingConfigs).where(eq(schema.pricingConfigs.id, insertedConfigId));
  await pool.end();
});

interface Point {
  latitude: number;
  longitude: number;
}

// Far enough from every other test file's own fixtures (tens of
// thousands of km) that this file's driver can never be an eligible
// candidate for a ride some other file's test creates, and vice versa —
// the same isolation reasoning driverOffers.test.ts's own uniquePickup
// documents; this file shares the same real, unreset database.
function uniquePickup(): Point {
  return { latitude: Math.random() * 140 - 70, longitude: Math.random() * 340 - 170 };
}

function destinationNear(pickup: Point): Point {
  return { latitude: pickup.latitude - 0.05, longitude: pickup.longitude + 0.05 };
}

describe('Critical E2E path (Phase 21)', () => {
  it(
    'passenger registers through admin inspection, in one continuous flow, and every step succeeds',
    async () => {
      const pickup = uniquePickup();
      const destination = destinationNear(pickup);

      // --- Step 1: Passenger registers ---
      const passengerEmail = `critical-passenger-${randomUUID()}@example-test.test`;
      const registerResponse = await request(app).post('/auth/passengers/register').send({
        email: passengerEmail,
        password: 'abcd1234',
        firstName: 'Critical',
        lastName: 'Passenger',
      });
      expect(registerResponse.status).toBe(201);
      const passengerToken = registerResponse.body.data.tokens.accessToken as string;
      expect(registerResponse.body.data.user.email).toBe(passengerEmail);

      // A driver has to already exist, be APPROVED, ONLINE, and located
      // near the pickup for matching to have anyone to offer the ride
      // to — this is background setup, not one of the spec's own
      // numbered steps (no public API grants approval; see Phase 14).
      const driverEmail = `critical-driver-${randomUUID()}@example-test.test`;
      const driverRegisterResponse = await request(app).post('/auth/drivers/register').send({
        email: driverEmail,
        password: 'abcd1234',
        firstName: 'Critical',
        lastName: 'Driver',
        licenseNumber: `DL-${randomUUID()}`,
        licenseState: 'CA',
      });
      expect(driverRegisterResponse.status).toBe(201);
      const driverToken = driverRegisterResponse.body.data.tokens.accessToken as string;
      const driverUserId = driverRegisterResponse.body.data.user.id as string;

      const [driverProfileRow] = await db
        .select({ id: schema.driverProfiles.id })
        .from(schema.driverProfiles)
        .where(eq(schema.driverProfiles.userId, driverUserId))
        .limit(1);
      if (!driverProfileRow) throw new Error('Driver profile not found after registration');
      await db
        .update(schema.driverProfiles)
        .set({ onboardingStatus: 'APPROVED' })
        .where(eq(schema.driverProfiles.id, driverProfileRow.id));

      const goOnlineResponse = await request(app)
        .patch('/drivers/me/availability')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'ONLINE' });
      expect(goOnlineResponse.status).toBe(200);

      const initialPingResponse = await request(app)
        .post('/drivers/me/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ latitude: pickup.latitude, longitude: pickup.longitude });
      expect(initialPingResponse.status).toBe(200);

      // --- Steps 2 & 3: chooses pickup / chooses destination ---
      // Represented by `pickup`/`destination` above — the coordinate
      // pair a real client's map interaction would have already
      // produced before calling either endpoint below.

      // --- Step 4: receives estimate ---
      const estimateResponse = await request(app)
        .post('/pricing/estimate')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ origin: pickup, destination });
      expect(estimateResponse.status).toBe(200);
      const estimate = estimateResponse.body.data;
      expect(estimate.totalCents).toBeGreaterThan(0);
      expect(estimate.platformCommissionCents + estimate.driverEarningsCents).toBe(estimate.totalCents);

      // --- Step 5: requests ride ---
      const requestRideResponse = await request(app)
        .post('/rides')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          pickup: { coordinate: pickup, label: 'Critical Path Pickup' },
          destination: { coordinate: destination, label: 'Critical Path Destination' },
          idempotencyKey: randomUUID(),
        });
      expect(requestRideResponse.status).toBe(201);
      const rideId = requestRideResponse.body.data.id as string;
      expect(requestRideResponse.body.data.status).toBe('SEARCHING_DRIVER');

      // --- Step 6: driver receives offer ---
      const offerResponse = await request(app)
        .get('/drivers/me/offer')
        .set('Authorization', `Bearer ${driverToken}`);
      expect(offerResponse.status).toBe(200);
      expect(offerResponse.body.data).not.toBeNull();
      expect(offerResponse.body.data.ride.id).toBe(rideId);
      const rideRequestId = offerResponse.body.data.id as string;

      // --- Step 7: driver accepts ---
      const acceptResponse = await request(app)
        .post(`/drivers/me/offer/${rideRequestId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`);
      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.data.status).toBe('DRIVER_ASSIGNED');

      // --- Step: passenger receives driver information ---
      // Available the instant a ride is DRIVER_ASSIGNED (rideTrackingService
      // .getAssignedDriverInfo), not just once the driver starts moving —
      // asserted here, right after acceptance, as its own checkpoint,
      // distinct from "passenger sees driver location" below (step 11's
      // location pings), which is about the driver's *position* updating,
      // not their identity first becoming visible.
      const assignedDriverResponse = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passengerToken}`);
      expect(assignedDriverResponse.status).toBe(200);
      expect(assignedDriverResponse.body.data).not.toBeNull();
      expect(assignedDriverResponse.body.data.firstName).toBe('Critical');

      const driverAuth = { Authorization: `Bearer ${driverToken}` };

      // --- Step 8: driver travels to pickup ---
      const enRouteResponse = await request(app)
        .post(`/drivers/me/rides/${rideId}/en-route`)
        .set(driverAuth);
      expect(enRouteResponse.status).toBe(200);
      expect(enRouteResponse.body.data.status).toBe('DRIVER_EN_ROUTE');

      // A passenger tracking the ride mid-travel — GET /rides/:id/driver
      // reflects the driver's current reported position.
      const trackingDuringTravelResponse = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passengerToken}`);
      expect(trackingDuringTravelResponse.status).toBe(200);
      expect(trackingDuringTravelResponse.body.data.firstName).toBe('Critical');

      // --- Step 9: driver arrives ---
      const arrivedResponse = await request(app).post(`/drivers/me/rides/${rideId}/arrived`).set(driverAuth);
      expect(arrivedResponse.status).toBe(200);
      expect(arrivedResponse.body.data.status).toBe('DRIVER_ARRIVED');

      // --- Step 10: ride starts (PASSENGER_ONBOARD -> IN_PROGRESS) ---
      const pickedUpResponse = await request(app).post(`/drivers/me/rides/${rideId}/picked-up`).set(driverAuth);
      expect(pickedUpResponse.status).toBe(200);
      expect(pickedUpResponse.body.data.status).toBe('PASSENGER_ONBOARD');

      const startResponse = await request(app).post(`/drivers/me/rides/${rideId}/start`).set(driverAuth);
      expect(startResponse.status).toBe(200);
      expect(startResponse.body.data.status).toBe('IN_PROGRESS');

      // --- Step 11: location updates ---
      // Two more pings once the ride is actually in progress —
      // ride_location_samples (Phase 10) only records while IN_PROGRESS,
      // and this is what actualDistanceMeters gets computed from at
      // completion (see rideLifecycleService.computeActualDistanceMeters).
      const midpoint = { latitude: (pickup.latitude + destination.latitude) / 2, longitude: (pickup.longitude + destination.longitude) / 2 };
      const midPingResponse = await request(app)
        .post('/drivers/me/location')
        .set(driverAuth)
        .send({ latitude: midpoint.latitude, longitude: midpoint.longitude });
      expect(midPingResponse.status).toBe(200);

      const finalPingResponse = await request(app)
        .post('/drivers/me/location')
        .set(driverAuth)
        .send({ latitude: destination.latitude, longitude: destination.longitude });
      expect(finalPingResponse.status).toBe(200);

      const trackingMidRideResponse = await request(app)
        .get(`/rides/${rideId}/driver`)
        .set('Authorization', `Bearer ${passengerToken}`);
      expect(trackingMidRideResponse.status).toBe(200);
      expect(trackingMidRideResponse.body.data.location).not.toBeNull();

      // --- Step 12: ride completes ---
      const completeResponse = await request(app).post(`/drivers/me/rides/${rideId}/complete`).set(driverAuth);
      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.data.status).toBe('COMPLETED');
      const finalFareCents = completeResponse.body.data.finalFareCents as number;
      expect(finalFareCents).toBeGreaterThan(0);

      // --- Step 13: TEST payment succeeds ---
      const paymentResponse = await request(app)
        .get(`/rides/${rideId}/payment`)
        .set('Authorization', `Bearer ${passengerToken}`);
      expect(paymentResponse.status).toBe(200);
      expect(paymentResponse.body.data.status).toBe('SUCCEEDED');
      expect(paymentResponse.body.data.amountCents).toBe(finalFareCents);
      // Provider-safe only — no raw card data anywhere in the response
      // (section 11's own guarantee, re-checked here in the full flow).
      expect(JSON.stringify(paymentResponse.body.data)).not.toMatch(/\d{12,19}/);

      // --- Step 14: driver earnings created ---
      const earningsSummaryResponse = await request(app)
        .get('/drivers/me/earnings/summary')
        .set(driverAuth);
      expect(earningsSummaryResponse.status).toBe(200);
      expect(earningsSummaryResponse.body.data.today.rideCount).toBeGreaterThanOrEqual(1);
      expect(earningsSummaryResponse.body.data.today.grossFareCents).toBeGreaterThanOrEqual(finalFareCents);

      const earningsHistoryResponse = await request(app)
        .get('/drivers/me/earnings/history')
        .set(driverAuth);
      expect(earningsHistoryResponse.status).toBe(200);
      const earningsEntry = (earningsHistoryResponse.body.data as Array<{ rideId: string }>).find(
        (row) => row.rideId === rideId,
      );
      expect(earningsEntry).toMatchObject({
        rideId,
        grossFareCents: finalFareCents,
        paymentStatus: 'SUCCEEDED',
      });

      // --- Step 15: ratings enabled ---
      const passengerRatesDriverResponse = await request(app)
        .post(`/rides/${rideId}/rating`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ stars: 5, comment: 'Smooth ride, right on time.' });
      expect(passengerRatesDriverResponse.status).toBe(201);

      const driverRatesPassengerResponse = await request(app)
        .post(`/drivers/me/rides/${rideId}/rating`)
        .set(driverAuth)
        .send({ stars: 5, comment: 'Easy pickup, friendly.' });
      expect(driverRatesPassengerResponse.status).toBe(201);

      const ratingsResponse = await request(app)
        .get(`/rides/${rideId}/ratings`)
        .set('Authorization', `Bearer ${passengerToken}`);
      expect(ratingsResponse.status).toBe(200);
      expect(ratingsResponse.body.data.passengerToDriver?.stars).toBe(5);
      expect(ratingsResponse.body.data.driverToPassenger?.stars).toBe(5);

      // --- Step 16: Admin can inspect operation ---
      const adminEmail = `critical-admin-${randomUUID()}@example-test.test`;
      const adminPasswordHash = await hashPassword('abcd1234');
      await db.insert(schema.users).values({ email: adminEmail, passwordHash: adminPasswordHash, role: 'ADMIN' });
      const adminLoginResponse = await request(app)
        .post('/auth/login')
        .send({ email: adminEmail, password: 'abcd1234' });
      expect(adminLoginResponse.status).toBe(200);
      const adminToken = adminLoginResponse.body.data.tokens.accessToken as string;

      const adminRideDetailResponse = await request(app)
        .get(`/admin/rides/${rideId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRideDetailResponse.status).toBe(200);
      expect(adminRideDetailResponse.body.data).toMatchObject({
        id: rideId,
        status: 'COMPLETED',
        finalFareCents,
      });
      expect(adminRideDetailResponse.body.data.pickup.label).toBe('Critical Path Pickup');
      expect(adminRideDetailResponse.body.data.destination.label).toBe('Critical Path Destination');

      const adminPaymentsResponse = await request(app)
        .get('/admin/payments')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminPaymentsResponse.status).toBe(200);
      expect(
        (adminPaymentsResponse.body.data as Array<{ rideId: string; status: string }>).some(
          (row) => row.rideId === rideId && row.status === 'SUCCEEDED',
        ),
      ).toBe(true);

      const adminRatingsResponse = await request(app)
        .get('/admin/ratings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRatingsResponse.status).toBe(200);
      expect(
        (adminRatingsResponse.body.data as Array<{ rideId: string }>).filter((row) => row.rideId === rideId),
      ).toHaveLength(2); // both directions

      // --- Step: platform TEST revenue is recorded ---
      // GET /admin/revenue (Phase 12) is the platform-wide counterpart to
      // the driver's own earnings/summary asserted above — same
      // today/week/month/all-time shape, but this ride's platform
      // commission specifically. Always Stripe TEST MODE money (see the
      // route's own doc comment) — a count of this fictional test ride,
      // never real revenue.
      const adminRevenueResponse = await request(app)
        .get('/admin/revenue')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRevenueResponse.status).toBe(200);
      expect(adminRevenueResponse.body.data.today.rideCount).toBeGreaterThanOrEqual(1);
      expect(adminRevenueResponse.body.data.today.platformCommissionCents).toBeGreaterThan(0);
      expect(adminRevenueResponse.body.data.allTime.rideCount).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});
