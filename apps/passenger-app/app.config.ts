import type { ExpoConfig } from 'expo/config';

// app.config.ts (not static app.json) so the Android Google Maps API key
// can be injected from an env var at config-evaluation time. No key is
// hardcoded; if EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is unset, Android map
// tiles simply won't render — a known Stage 1 limitation (docs/maps.md)
// since this environment has no way to provision or verify a real key.
// iOS uses Apple Maps by default and needs no key at all.
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const config: ExpoConfig = {
  name: 'Rideshare Passenger (Dev)',
  slug: 'rideshare-passenger-app',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'rideshare-passenger',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.rideshare.passenger',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Rideshare Passenger uses your location to set your pickup point and show nearby rides.',
    },
  },
  android: {
    package: 'dev.rideshare.passenger',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(googleMapsApiKey ? { config: { googleMaps: { apiKey: googleMapsApiKey } } } : {}),
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Rideshare Passenger uses your location to set your pickup point and show nearby rides.',
      },
    ],
  ],
  extra: {
    stage: 'stage-1-development',
  },
};

export default config;
