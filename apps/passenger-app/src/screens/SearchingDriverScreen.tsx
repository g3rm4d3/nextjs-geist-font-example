import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRideDraft } from '../context/RideDraftContext';
import { formatCents, formatDistanceMiles, formatDurationMinutes } from '../lib/format';

/**
 * The ride created in Phase 7 sits in SEARCHING_DRIVER indefinitely —
 * matching a driver to it is explicitly Phase 8's job, not this one's
 * ("Do NOT automatically match driver until Phase 8"). This screen shows
 * the real ride RequestRideScreen just created (not a placeholder — the
 * data is genuinely available now) but has nothing to *do* with it yet:
 * no polling, no offers, no ETA. That honest gap is the point.
 */
export function SearchingDriverScreen() {
  const { pickup, destination, ride } = useRideDraft();

  if (!ride || !pickup || !destination) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No active ride request.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" size="large" style={styles.spinner} />
        <Text style={styles.title}>Searching for a driver…</Text>
        <Text style={styles.subtitle}>
          The matching engine that finds and offers rides to nearby drivers is built in Phase 8.
          This request will stay in {ride.status} until then.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.routeLabel}>
          {pickup.label} → {destination.label}
        </Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Status</Text>
          <Text style={styles.rowValue}>{ride.status}</Text>
        </View>
        {ride.estimatedDistanceMeters !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Distance</Text>
            <Text style={styles.rowValue}>{formatDistanceMiles(ride.estimatedDistanceMeters)}</Text>
          </View>
        )}
        {ride.estimatedDurationSeconds !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Estimated duration</Text>
            <Text style={styles.rowValue}>{formatDurationMinutes(ride.estimatedDurationSeconds)}</Text>
          </View>
        )}
        {ride.estimatedFareCents !== null && (
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Estimated fare</Text>
            <Text style={styles.totalValue}>{formatCents(ride.estimatedFareCents)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  spinner: { marginBottom: 16 },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#94a3b8', fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 18 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
  },
  routeLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  totalRow: { borderBottomWidth: 0, paddingTop: 12 },
  rowLabel: { color: '#94a3b8', fontSize: 14 },
  rowValue: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  totalLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  totalValue: { color: '#fbbf24', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171' },
});
