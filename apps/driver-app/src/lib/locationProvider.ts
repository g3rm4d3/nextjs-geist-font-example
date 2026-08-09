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

export type LocationPermissionState = 'granted' | 'denied';

export interface LocationProvider {
  /** Resolves once with the driver's current position. */
  getCurrentLocation(): Promise<{ coordinate: Coordinate; permission: LocationPermissionState }>;
  /** Calls `onUpdate` with each new position; returns an unsubscribe function. */
  watchLocation(onUpdate: (coordinate: Coordinate) => void): () => void;
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
        return { coordinate: env.mockGpsCoordinate, permission: 'denied' };
      }

      const position = await Location.getCurrentPositionAsync({});
      return {
        coordinate: { latitude: position.coords.latitude, longitude: position.coords.longitude },
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
            onUpdate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
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
 * instead of a suspiciously frozen pin.
 */
function createMockLocationProvider(): LocationProvider {
  const DRIFT_DEGREES = 0.0006; // roughly one city block per tick
  const TICK_MS = 4000;

  return {
    async getCurrentLocation() {
      return { coordinate: env.mockGpsCoordinate, permission: 'granted' };
    },

    watchLocation(onUpdate) {
      let current = { ...env.mockGpsCoordinate };

      const interval = setInterval(() => {
        current = {
          latitude: current.latitude + (Math.random() - 0.5) * DRIFT_DEGREES,
          longitude: current.longitude + (Math.random() - 0.5) * DRIFT_DEGREES,
        };
        onUpdate(current);
      }, TICK_MS);

      return () => clearInterval(interval);
    },
  };
}

export function getLocationProvider(): LocationProvider {
  return env.mockGpsEnabled ? createMockLocationProvider() : createExpoLocationProvider();
}
