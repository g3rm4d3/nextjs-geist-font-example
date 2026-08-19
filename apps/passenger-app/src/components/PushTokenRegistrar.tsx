import { useEffect } from 'react';
import { registerPushToken } from '../lib/apiClient';
import { registerForPushNotificationsAsync } from '../lib/pushNotifications';

/**
 * Renders nothing — registers this device's Expo push token (when push
 * is actually available; see pushNotifications.ts) against the
 * authenticated user once per sign-in. Mounted once at the root of the
 * signed-in navigation tree (RootNavigator) rather than inside any one
 * screen, so registration doesn't depend on the passenger ever visiting
 * a particular screen. Best-effort throughout: a failed or unavailable
 * push token never surfaces an error to the passenger — see
 * registerForPushNotificationsAsync's own comment.
 */
export function PushTokenRegistrar({ accessToken }: { accessToken: string }) {
  useEffect(() => {
    let cancelled = false;

    async function register() {
      const result = await registerForPushNotificationsAsync();
      if (!result || cancelled) return;
      await registerPushToken(accessToken, { token: result.token, platform: result.platform }).catch(
        () => undefined,
      );
    }

    void register();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return null;
}
