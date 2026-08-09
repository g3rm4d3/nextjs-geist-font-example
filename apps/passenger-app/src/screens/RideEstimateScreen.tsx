import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRideDraft } from '../context/RideDraftContext';
import { formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideEstimate'>;

/**
 * Shows the route (distance/duration) computed in Phase 3. There is
 * deliberately no fare shown here yet — the PricingEngine that turns a
 * route into a server-generated fare estimate is Phase 4's job, and
 * fares must never be computed or displayed as authoritative from
 * anything other than that engine (section 3).
 */
export function RideEstimateScreen({ navigation }: Props) {
  const { pickup, destination, route } = useRideDraft();

  if (!pickup || !destination || !route) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Preview a route first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.routeLabel}>
        {pickup.label} → {destination.label}
      </Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Distance</Text>
          <Text style={styles.rowValue}>{formatDistanceMiles(route.distanceMeters)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Estimated duration</Text>
          <Text style={styles.rowValue}>{formatDurationMinutes(route.durationSeconds)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Fare</Text>
          <Text style={styles.rowValueMuted}>Coming in Phase 4 (Pricing Engine)</Text>
        </View>
      </View>

      <Pressable
        style={styles.requestButton}
        onPress={() => navigation.navigate('RequestRide')}
        testID="request-ride-button"
      >
        <Text style={styles.requestButtonText}>Request Ride</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  routeLabel: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 20 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  rowLabel: { color: '#94a3b8', fontSize: 14 },
  rowValue: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  rowValueMuted: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  requestButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  requestButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171' },
});
