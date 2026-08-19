import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface PushRegistrationResult {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

/**
 * Section 16: "Add push notification capability when configuration
 * permits." Requests permission, then asks Expo for this device's push
 * token. Returns null — never throws — whenever push isn't actually
 * available: no physical device (the iOS/Android simulators this
 * environment runs on can't mint a real push token), permission denied,
 * or no EAS project configured. Callers treat "no push" as the normal,
 * unremarkable Stage 1 case it is (see docs/notifications.md) rather
 * than a failure worth surfacing to the passenger.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const response = await Notifications.getExpoPushTokenAsync();
    const platform: PushRegistrationResult['platform'] =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    return { token: response.data, platform };
  } catch {
    return null;
  }
}
