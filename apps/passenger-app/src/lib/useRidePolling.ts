import type { Ride } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, getRide } from './apiClient';

const POLL_INTERVAL_MS = 4000;

export interface RidePollingResult {
  ride: Ride | null;
  errorMessage: string | null;
}

/**
 * Polls `GET /rides/:id` on an interval and keeps `RideDraftContext.ride`
 * in sync — shared by SearchingDriverScreen, DriverAssignedScreen, and
 * RideTrackingScreen (Phase 10), each of which watches the returned
 * `ride.status` in its own effect to decide when to navigate onward (or
 * back, on cancellation). One poll loop, not three near-identical
 * copies — same reasoning as apps/driver-app's DriverHomeMapScreen offer
 * poll, applied to a status that can now change from either side (driver
 * actions, Phase 9) instead of just this app's own.
 */
export function useRidePolling(
  accessToken: string | null,
  rideId: string | null,
): RidePollingResult {
  const { setRide } = useRideDraft();
  const [ride, setLocalRide] = useState<Ride | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !rideId) return undefined;

    let cancelled = false;

    async function poll(token: string, id: string) {
      try {
        const result = await getRide(token, id);
        if (cancelled) return;
        setLocalRide(result);
        setRide(result);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load ride status.',
        );
      }
    }

    void poll(accessToken, rideId);
    const interval = setInterval(() => void poll(accessToken, rideId), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accessToken, rideId, setRide]);

  return { ride, errorMessage };
}
