/**
 * Expo inlines EXPO_PUBLIC_* variables at build time. Never put secrets in
 * an EXPO_PUBLIC_ variable — anything here ships inside the client bundle.
 */
export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
};
