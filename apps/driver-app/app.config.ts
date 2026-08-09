import type { ExpoConfig } from 'expo/config';

// app.config.ts (not static app.json) so the Android Google Maps API key
// can be injected from an env var at config-evaluation time — same
// reasoning as apps/passenger-app/app.config.ts (Phase 3). No key is
// hardcoded; if EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is unset, Android map
// tiles simply won't render (docs/maps.md). iOS uses Apple Maps by
// default and needs no key at all.
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const config: ExpoConfig = {
  name: 'Rideshare Driver (Dev)',
  slug: 'rideshare-driver-app',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'rideshare-driver',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.rideshare.driver',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Rideshare Driver uses your location to show your position on the map while you are online.',
    },
  },
  android: {
    package: 'dev.rideshare.driver',
    adaptiveIcon: {
      backgroundColor: '#FEF3C7',
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
          'Rideshare Driver uses your location to show your position on the map while you are online.',
      },
    ],
  ],
  extra: {
    stage: 'stage-1-development',
  },
};

export default config;
