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
    [
      'expo-image-picker',
      {
        // Phase 15: photographing/selecting a driver license, vehicle
        // registration, insurance card, or profile photo for document
        // upload. No microphone/audio permission is requested — only
        // still photos are ever captured here.
        photosPermission:
          'Rideshare Driver uses your photo library to attach a document (license, registration, insurance, profile photo).',
        cameraPermission:
          'Rideshare Driver uses your camera to photograph a document (license, registration, insurance, profile photo).',
      },
    ],
    [
      'expo-notifications',
      {
        // Phase 16: ride offer/status/payout notifications. No custom
        // sound/icon configured — the default Expo notification
        // presentation is enough for Stage 1 (docs/notifications.md).
      },
    ],
  ],
  extra: {
    stage: 'stage-1-development',
  },
};

export default config;
