import { StyleSheet, Text, View } from 'react-native';
import { useNetworkStatus } from '../lib/useNetworkStatus';
import { colors, fontSize, fontWeight, minTouchTarget, spacing } from '../theme';

/**
 * Phase 23 — proactively surfaces "you're offline" the moment
 * `useNetworkStatus` reports no connection, rather than waiting for the
 * next request to fail (see apiClient.ts's NETWORK_ERROR handling for
 * the reactive counterpart). Mounted once at RootNavigator's top level
 * so it's visible from every screen, signed in or not — the auth screen
 * itself needs a network connection just as much as any ride screen
 * does. Renders nothing at all while online: this is not a persistent
 * status indicator, only a warning that appears when it's actually
 * relevant.
 */
export function OfflineBanner() {
  const { isOffline } = useNetworkStatus();
  if (!isOffline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        You&apos;re offline — some actions won&apos;t work until you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: minTouchTarget,
    backgroundColor: colors.dangerStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  text: {
    color: colors.textPrimary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
