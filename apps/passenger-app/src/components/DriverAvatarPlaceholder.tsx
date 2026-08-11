import { StyleSheet, Text, View } from 'react-native';

/**
 * Section 10: "driver photo placeholder/test photo." There is no real
 * photo pipeline yet — that's Phase 15's document-upload work
 * (`PROFILE_PHOTO` document type) — so the API only ever sends a first
 * name (see AssignedRideDriverInfo), and this renders exactly what
 * "placeholder" means for Stage 1: an initial in a colored circle, not a
 * fetched image. Shared by DriverAssignedScreen and RideTrackingScreen.
 */
export function DriverAvatarPlaceholder({ firstName }: { firstName: string }) {
  const initial = firstName.charAt(0).toUpperCase() || '?';
  return (
    <View style={styles.circle}>
      <Text style={styles.initial}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fbbf24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: '#0f172a', fontSize: 22, fontWeight: '700' },
});
