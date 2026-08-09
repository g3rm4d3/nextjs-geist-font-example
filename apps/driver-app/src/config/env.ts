/**
 * Expo inlines EXPO_PUBLIC_* variables at build time. Never put secrets in
 * an EXPO_PUBLIC_ variable — anything here ships inside the client bundle.
 */

const DEFAULT_MOCK_LATITUDE = 39.7684;
const DEFAULT_MOCK_LONGITUDE = -86.158;

function parseCoordinate(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
  /**
   * Phase 5 requires "real GPS and configurable mock GPS during
   * development" — this environment has no simulator/device with a
   * usable GPS fix, so mock mode is what actually gets exercised here.
   * Real device/CI builds set this to "false" (or leave it unset) to use
   * expo-location's real position instead. See lib/locationProvider.ts.
   */
  mockGpsEnabled: process.env.EXPO_PUBLIC_MOCK_GPS === 'true',
  mockGpsCoordinate: {
    latitude: parseCoordinate(process.env.EXPO_PUBLIC_MOCK_GPS_LAT, DEFAULT_MOCK_LATITUDE),
    longitude: parseCoordinate(process.env.EXPO_PUBLIC_MOCK_GPS_LNG, DEFAULT_MOCK_LONGITUDE),
  },
};
