import * as Location from 'expo-location';
import { env } from '../config/env';

/** Deliberately not imported from @rideshare/maps — that package is a
 * server-side routing abstraction (apps/api only); this is a small
 * client-local shape, hand-duplicated the same way packages/types keeps
 * its own copies of shapes it depends on rather than crossing a package
 * boundary for two numbers. */
export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Everything POST /drivers/me/location (Phase 6) accepts, in one shape —
 * so a screen can hand a LocationSample straight to apiClient.reportLocation
 * without re-deriving fields. heading/speed/accuracy are omitted (not
 * `null`) when a provider can't supply them, matching the API's own
 * "all optional" schema instead of inventing a sentinel value.
 */
export interface LocationSample extends Coordinate {
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** ISO 8601 — when this fix was actually taken, not when it's sent. */
  timestamp: string;
}

export type LocationPermissionState = 'granted' | 'denied';

export interface LocationProvider {
  /** Resolves once with the driver's current position. */
  getCurrentLocation(): Promise<{ sample: LocationSample; permission: LocationPermissionState }>;
  /** Calls `onUpdate` with each new position; returns an unsubscribe function. */
  watchLocation(onUpdate: (sample: LocationSample) => void): () => void;
}

function toSample(coordinate: Coordinate, extra: Partial<LocationSample> = {}): LocationSample {
  return { ...coordinate, timestamp: new Date().toISOString(), ...extra };
}

/**
 * Real GPS via expo-location. This is what a device or CI build with an
 * actual location fix uses; it's also exactly what the passenger app's
 * HomeMapScreen already does (Phase 3) for requesting permission and
 * reading a position, applied here to a long-lived watch instead of a
 * one-shot read since a driver's position needs to keep updating while
 * they're online.
 */
function createExpoLocationProvider(): LocationProvider {
  return {
    async getCurrentLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return { sample: toSample(env.mockGpsCoordinate), permission: 'denied' };
      }

      const position = await Location.getCurrentPositionAsync({});
      return {
        sample: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          ...(position.coords.heading != null && position.coords.heading >= 0
            ? { heading: position.coords.heading }
            : {}),
          ...(position.coords.speed != null && position.coords.speed >= 0
            ? { speed: position.coords.speed }
            : {}),
          ...(position.coords.accuracy != null ? { accuracy: position.coords.accuracy } : {}),
          timestamp: new Date(position.timestamp).toISOString(),
        },
        permission: 'granted',
      };
    },

    watchLocation(onUpdate) {
      let subscription: Location.LocationSubscription | undefined;
      let cancelled = false;

      void Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
        if (status !== 'granted' || cancelled) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 25 },
          (position) => {
            onUpdate({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              ...(position.coords.heading != null && position.coords.heading >= 0
                ? { heading: position.coords.heading }
                : {}),
              ...(position.coords.speed != null && position.coords.speed >= 0
                ? { speed: position.coords.speed }
                : {}),
              ...(position.coords.accuracy != null ? { accuracy: position.coords.accuracy } : {}),
              timestamp: new Date(position.timestamp).toISOString(),
            });
          },
        );
      });

      return () => {
        cancelled = true;
        subscription?.remove();
      };
    },
  };
}

/**
 * Section 6's "configurable mock GPS during development" requirement.
 * No expo-location call is made at all in this mode — useful both for
 * this environment (no simulator/device with a real GPS fix exists here)
 * and for a real device/simulator that has no location configured. The
 * mock coordinate drifts slightly on each tick so a driver watching
 * their own position on DriverHomeMap sees the marker actually move,
 * instead of a suspiciously frozen pin, and carries a plausible
 * heading/speed so the reported location looks like a moving vehicle.
 */
function createMockLocationProvider(): LocationProvider {
  const DRIFT_DEGREES = 0.0006; // roughly one city block per tick
  const TICK_MS = 4000;
  const MOCK_ACCURACY_METERS = 12;

  return {
    async getCurrentLocation() {
      return {
        sample: toSample(env.mockGpsCoordinate, { accuracy: MOCK_ACCURACY_METERS }),
        permission: 'granted',
      };
    },

    watchLocation(onUpdate) {
      let current = { ...env.mockGpsCoordinate };

      const interval = setInterval(() => {
        const next = {
          latitude: current.latitude + (Math.random() - 0.5) * DRIFT_DEGREES,
          longitude: current.longitude + (Math.random() - 0.5) * DRIFT_DEGREES,
        };
        const heading = Math.random() * 360;
        // ~4-14 m/s (roughly city-street driving speed).
        const speed = 4 + Math.random() * 10;
        current = next;
        onUpdate(toSample(next, { heading, speed, accuracy: MOCK_ACCURACY_METERS }));
      }, TICK_MS);

      return () => clearInterval(interval);
    },
  };
}

export function getLocationProvider(): LocationProvider {
  return env.mockGpsEnabled ? createMockLocationProvider() : createExpoLocationProvider();
}
