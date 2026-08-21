import { StyleSheet, Text, View } from 'react-native';
import { useNetworkStatus } from '../lib/useNetworkStatus';
import { colors, fontSize, fontWeight, minTouchTarget, spacing } from '../theme';

/**
 * Phase 23 — proactively surfaces "you're offline" the moment
 * `useNetworkStatus` reports no connection, rather than waiting for the
 * next request to fail (see apiClient.ts's NETWORK_ERROR handling for
 * the reactive counterpart). Particularly important here: a driver who
 * goes offline mid-shift needs to know immediately, not after their
 * next location ping silently fails to reach the server. Mounted once
 * at RootNavigator's top level so it's visible from every screen.
 * Renders nothing at all while online.
 */
export function OfflineBanner() {
  const { isOffline } = useNetworkStatus();
  if (!isOffline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        You&apos;re offline — location updates and offers won&apos;t reach you.
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
