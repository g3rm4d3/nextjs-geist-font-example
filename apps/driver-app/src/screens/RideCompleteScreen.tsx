import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useActiveRide } from '../context/ActiveRideContext';
import { formatCents, formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideComplete'>;

/**
 * COMPLETED. `finalFareCents`/`actualDistanceMeters`/`actualDurationSeconds`
 * come straight from rideLifecycleService.completeRide's response — see
 * docs/ride-lifecycle.md for what "actual" means with no live route
 * tracking in Stage 1 (duration is genuinely real elapsed time; distance
 * reuses the pre-trip estimate). Earnings/ratings prompts need Phase 12
 * (financial ledger) and Phase 13 (ratings), neither of which exist yet —
 * "Done" just clears this ride and returns the driver to the map, ready
 * for the next offer.
 */
export function RideCompleteScreen({ navigation }: Props) {
  const { ride, clear } = useActiveRide();

  function handleDone() {
    clear();
    navigation.navigate('DriverHomeMap');
  }

  if (!ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>No ride to show</Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('DriverHomeMap')}>
          <Text style={styles.buttonText}>Back to map</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <Text style={styles.title}>Ride complete</Text>
        <Text style={styles.subtitle}>{ride.destination.label}</Text>
      </View>

      <View style={styles.card}>
        {ride.actualDistanceMeters !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Distance</Text>
            <Text style={styles.rowValue}>{formatDistanceMiles(ride.actualDistanceMeters)}</Text>
          </View>
        )}
        {ride.actualDurationSeconds !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Duration</Text>
            <Text style={styles.rowValue}>{formatDurationMinutes(ride.actualDurationSeconds)}</Text>
          </View>
        )}
        {ride.finalFareCents !== null && (
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Fare</Text>
            <Text style={styles.totalValue}>{formatCents(ride.finalFareCents)}</Text>
          </View>
        )}
      </View>

      <Pressable style={styles.button} onPress={handleDone} testID="done-button">
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20, justifyContent: 'space-between' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  title: { color: '#4ade80', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#a8a29e', fontSize: 14 },
  card: { backgroundColor: '#292524', borderRadius: 12, padding: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
  },
  totalRow: { borderBottomWidth: 0, paddingTop: 12 },
  rowLabel: { color: '#a8a29e', fontSize: 14 },
  rowValue: { color: '#fafaf9', fontSize: 14, fontWeight: '600' },
  totalLabel: { color: '#fafaf9', fontSize: 16, fontWeight: '700' },
  totalValue: { color: '#4ade80', fontSize: 18, fontWeight: '700' },
  button: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#fbbf24',
    marginBottom: 8,
  },
  buttonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
});
